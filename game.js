import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import * as E from "./engine.js";
import { notifyTurn } from "./push.js";

const html = htm.bind(h);

// Muted, editorial card colours — distinguishable but not candy.
const CARD_BG = { red: "#bf4a3c", blue: "#356b8c", green: "#3e7a58", yellow: "#b0822c" };

/* ----------------------------------------------------------- match hook --- */
// Live sync with belt-and-braces: realtime websocket for instant updates,
// reload on wake/focus/reconnect (phones kill the socket when locked), a
// gentle heartbeat while visible, and auto-resubscribe if the channel drops.
function useMatch(client, room = null) {
  const [match, setMatch] = useState(undefined); // undefined=loading, null=none
  const matchRef = useRef(undefined);
  useEffect(() => { matchRef.current = match; }, [match]);
  // room === null → the couple's private game (unchanged). A slug → a public
  // Game Room instance. Both live in `matches`, told apart by the room column.
  const sameScope = (r) => (r && (r.room ?? null) === (room ?? null));

  const load = useCallback(async () => {
    // never yank cards mid-drag — but self-expire the guard so a drag that died
    // without cleanup can't freeze sync forever (the old refresh-to-fix bug)
    if (window.__ppDragging && Date.now() - (window.__ppDragSince || 0) < 4000) return;
    window.__ppDragging = false;
    let q = client.from("matches").select("*").eq("status", "playing");
    q = room ? q.eq("room", room) : q.is("room", null);
    const { data } = await q.order("created_at", { ascending: false }).limit(1);
    const row = (data && data[0]) || null;
    const cur = matchRef.current;
    if (row && cur && row.id === cur.id && row.version === cur.version) return; // unchanged
    setMatch(row);
  }, [client, room]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let alive = true, ch = null;
    const subscribe = () => {
      ch = client.channel("pp-match-" + Math.random().toString(36).slice(2, 7))
        .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, (p) => {
          if (p.eventType === "DELETE") { load(); return; }
          const row = p.new;
          if (!sameScope(row)) return;                                   // ignore other rooms' matches
          if (window.__ppDragging) { setTimeout(load, 1200); return; }   // catch up right after the drag
          if (row.status === "playing") setMatch(row);
          else load();
        })
        .subscribe((status) => {
          // websocket died → make a fresh channel, then catch up on missed moves
          if (alive && (status === "CHANNEL_ERROR" || status === "TIMED_OUT")) {
            setTimeout(() => { if (alive) { try { client.removeChannel(ch); } catch {} subscribe(); load(); } }, 1500);
          }
        });
    };
    subscribe();

    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    const beat = setInterval(wake, 20000);       // fallback poll while visible

    return () => {
      alive = false;
      clearInterval(beat);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      try { client.removeChannel(ch); } catch {}
    };
  }, [client, load]);

  return [match, setMatch, load];
}

/* ----------------------------------------------------------- PlayTab ------ */
export function PlayTab(ctx) {
  const { client, players, me, api, flash } = ctx;
  const room = ctx.room || null;                       // null = private game; slug = Game Room instance
  const [match, setMatch, reload] = useMatch(client, room);
  // Home shows a compact Resume card by default — tapping the Score tab should
  // land on the home page, NOT jump straight into the full-screen hand. The
  // board opens full-screen only when you choose to (Open game / Play turn).
  const [immersive, setImmersive] = useState(false);
  const busy = useRef(false);

  const commit = useCallback(async (newState) => {
    if (!match || busy.current) return;
    busy.current = true;
    const prevStatus = match.state.status;
    const version = match.version;
    // Keep the row 'playing' so both phones can still load the Hand-Over /
    // Match-Over screens from `state.status`. It's only retired to 'finished'
    // when a brand-new match replaces it (see MatchOver → newMatch).
    const status = "playing";
    const optimistic = { ...match, state: newState, version: version + 1, status };
    setMatch(optimistic);
    const { data, error } = await client.from("matches")
      .update({ state: newState, version: version + 1, status, updated_at: new Date().toISOString() })
      .eq("id", match.id).eq("version", version).select();
    busy.current = false;
    if (error) { flash("⚠️ " + error.message); reload(); return; }
    if (!data || !data.length) { flash("Out of sync — refreshing"); reload(); return; }
    // First client to see the win records it for lifetime + grants the trophy.
    if (newState.status === "matchOver" && prevStatus !== "matchOver" && newState.winner) {
      await recordWin(client, api, newState.winner);
    }
    // My move handed the turn to my partner → nudge their phone (fire & forget).
    // Covers a discard that flips the turn AND dealing a new hand they start.
    const prevTurn = match.state.turn;
    if (newState.status === "playing" && newState.turn !== me.id &&
        (newState.turn !== prevTurn || prevStatus !== "playing")) {
      notifyTurn(client, newState.turn, "Your turn! 🎴", `${me.emoji} ${me.name} played — hand ${newState.handNumber} is waiting.`);
    }
    // I skipped my partner → tell them why it's not their turn.
    if (newState.skipInfo && newState.skipInfo.by === me.id &&
        newState.skipInfo.seq !== (match.state.skipInfo?.seq || 0)) {
      notifyTurn(client, newState.skipInfo.victim, "You got Skipped! ⊘", `${me.emoji} ${me.name} played a Skip on you — they go again 😈`);
    }
  }, [match, client, api, flash, reload, setMatch, me]);

  // ---- presence (👋 they're here) + emoji reactions (broadcast, no DB) ----
  const opp = players.find((p) => p.id !== me.id);
  const demoMode = !!client._db;
  const [online, setOnline] = useState({});
  const [floats, setFloats] = useState([]);
  const [sheet, setSheet] = useState(false);
  const [reactedVer, setReactedVer] = useState(-1);   // one reaction per move
  const reactCh = useRef(null);

  const spawnFloat = useCallback((emoji) => {
    const id = Math.random().toString(36).slice(2);
    setFloats((f) => [...f, { id, emoji, x: 8 + Math.random() * 72 }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 2600);
  }, []);

  useEffect(() => {
    if (demoMode) return;
    const ch = client.channel("pp-presence", { config: { presence: { key: me.id } } });
    reactCh.current = ch;
    ch.on("presence", { event: "sync" }, () => setOnline({ ...ch.presenceState() }))
      .on("broadcast", { event: "react" }, ({ payload }) => { if (payload && payload.emoji) spawnFloat(payload.emoji); })
      .subscribe(async (status) => { if (status === "SUBSCRIBED") { try { await ch.track({ at: Date.now() }); } catch {} } });
    return () => { reactCh.current = null; try { client.removeChannel(ch); } catch {} };
  }, [client, me.id, demoMode, spawnFloat]);

  const oppOnline = demoMode || !!(opp && online[opp.id]);
  const bothOnline = demoMode || (!!online[me.id] && !!(opp && online[opp.id]));

  // ---- 💩 trash talk: per-hand chat bubbles, purged when the next hand deals
  const [talk, setTalk] = useState([]);
  const [talkOpen, setTalkOpen] = useState(false);
  const [talkText, setTalkText] = useState("");
  const talkInput = useRef(null);
  const matchId = match ? match.id : null;
  const handNo = match && match.state ? match.state.handNumber : null;
  const loadTalk = useCallback(async () => {
    if (!matchId || !handNo) { setTalk([]); return; }
    const { data, error } = await client.from("trash_talk").select("*")
      .eq("match_id", matchId).eq("hand_number", handNo).order("created_at");
    // never clobber optimistic in-flight bubbles with a stale read
    if (!error && data) setTalk((t) => {
      const pending = t.filter((x) => x.pending && !data.some((d) => d.text === x.text && d.player_id === x.player_id));
      return [...data, ...pending];
    });
    // purge older hands' smack opportunistically (fire & forget)
    client.from("trash_talk").delete().eq("match_id", matchId).lt("hand_number", handNo).then(() => {});
  }, [client, matchId, handNo]);
  useEffect(() => { loadTalk(); }, [loadTalk]);
  useEffect(() => {
    if (demoMode || !matchId) return;
    let alive = true, ch = null;
    const sub = () => {
      ch = client.channel("pp-talk-" + Math.random().toString(36).slice(2, 7))
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "trash_talk" }, (p) => {
          const r = p.new;
          if (r.match_id === matchId && r.hand_number === handNo) {
            setTalk((t) => (t.some((x) => x.id === r.id) ? t : [...t, r]));
            if (r.player_id !== me.id) { try { navigator.vibrate && navigator.vibrate(15); } catch {} }
          }
        })
        .subscribe((status) => {
          // dropped websocket → fresh channel + catch up on missed smack
          if (alive && (status === "CHANNEL_ERROR" || status === "TIMED_OUT")) {
            setTimeout(() => { if (alive) { try { client.removeChannel(ch); } catch {} sub(); loadTalk(); } }, 1500);
          }
        });
    };
    sub();
    const wake = () => { if (document.visibilityState === "visible") loadTalk(); };
    document.addEventListener("visibilitychange", wake);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", wake);
      try { client.removeChannel(ch); } catch {}
    };
  }, [client, matchId, handNo, demoMode, loadTalk]);
  const sendTalk = async () => {
    const text = talkText.trim().slice(0, 140);
    if (!text || !matchId) return;
    setTalkText("");
    try { talkInput.current && talkInput.current.focus(); } catch {}   // rapid banter
    const tmpId = "tmp-" + Math.random().toString(36).slice(2);
    const optimistic = { id: tmpId, pending: true, match_id: matchId, hand_number: handNo, player_id: me.id, text, created_at: new Date().toISOString() };
    setTalk((t) => [...t, optimistic]);
    const { data, error } = await client.from("trash_talk")
      .insert({ match_id: matchId, hand_number: handNo, player_id: me.id, text }).select().single();
    if (error || !data) {
      // honest failure: remove the ghost bubble, give their words back
      setTalk((t) => t.filter((x) => x.id !== tmpId));
      setTalkText(text);
      flash("⚠️ message didn’t send");
      return;
    }
    // the realtime echo may already have delivered the real row — dedupe
    setTalk((t) => {
      const cleaned = t.filter((x) => x.id !== tmpId);
      return cleaned.some((x) => x.id === data.id) ? cleaned : [...cleaned, data];
    });
  };
  // keep the composer above the iOS keyboard (visual viewport tracking)
  const [kbLift, setKbLift] = useState(0);
  useEffect(() => {
    if (!talkOpen || !window.visualViewport) return;
    const vv = window.visualViewport;
    const onVV = () => setKbLift(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    onVV();
    vv.addEventListener("resize", onVV);
    vv.addEventListener("scroll", onVV);
    return () => { vv.removeEventListener("resize", onVV); vv.removeEventListener("scroll", onVV); setKbLift(0); };
  }, [talkOpen]);
  useEffect(() => { if (talkOpen) { try { talkInput.current && talkInput.current.focus(); } catch {} } }, [talkOpen]);
  const canReact = !!match && reactedVer !== match.version;
  const sendReact = (emoji) => {
    if (!canReact) return;
    setReactedVer(match.version);
    setSheet(false);
    spawnFloat(emoji);
    try { navigator.vibrate && navigator.vibrate(20); } catch {}
    try { reactCh.current && reactCh.current.send({ type: "broadcast", event: "react", payload: { emoji, from: me.id } }); } catch {}
  };

  if (match === undefined) {
    return html`<div class="card center"><div class="muted">Loading game…</div></div>`;
  }
  if (match === null) {
    return html`<${StartMatch} players=${players} client=${client} room=${room} onStarted=${(row) => { setMatch(row); setImmersive(true); }} flash=${flash} />`;
  }
  // The live hand plays full-screen. "‹" pops back to the tabbed app, where
  // this tab shows a compact Resume card. "🏳" requests ending the match —
  // it only ends when BOTH players agree.
  if (immersive) {
    const s = match.state;
    const pinfo = (id) => players.find((p) => p.id === id) || { name: "?", emoji: "❔" };
    const endReq = s.endRequest || null;
    const requestEnd = () => commit({ ...s, endRequest: me.id });
    const keepPlaying = () => commit({ ...s, endRequest: null });
    const confirmEnd = async () => {
      await client.from("matches").update({ status: "finished" }).eq("id", match.id);
      setMatch(null); // partner's phone follows via realtime
    };
    return html`<div class="gamefs">
      <div class="gamefs-bar">
        <button class="iconbtn" onClick=${() => setImmersive(false)}>‹</button>
        <div class="gamefs-title">Hand ${s.handNumber}</div>
        <button class="iconbtn ${endReq ? "on" : ""}" title="End match" onClick=${endReq === me.id ? keepPlaying : requestEnd}>🏳</button>
      </div>
      ${endReq && html`<div class="endbar">
        ${endReq === me.id
          ? html`<span>Waiting for ${pinfo(s.players.find((p) => p !== me.id)).emoji} to agree to end</span>
                 <button class="linkbtn" onClick=${keepPlaying}>Cancel</button>`
          : html`<span>${pinfo(endReq).emoji} ${pinfo(endReq).name} wants to end this match</span>
                 <span class="row">
                   <button class="btn sm" onClick=${confirmEnd}>End it</button>
                   <button class="linkbtn" onClick=${keepPlaying}>Keep playing</button>
                 </span>`}
      </div>`}
      <div class="gamefs-body">
        <${Board} ...${ctx} match=${match} commit=${commit} setMatch=${setMatch} oppOnline=${oppOnline} talk=${talk} />
      </div>

      <button class=${`talkfab ${talkOpen ? "on" : ""}`} title="Talk your shit" onClick=${() => setTalkOpen(!talkOpen)}>💩</button>
      ${talkOpen && html`<div class="talkbar" style=${kbLift ? `bottom:${kbLift + 12}px` : ""}>
        <input ref=${talkInput} placeholder="talk your shit…" maxlength="140" value=${talkText}
          onInput=${(e) => setTalkText(e.target.value)}
          onKeyDown=${(e) => { if (e.key === "Enter") sendTalk(); if (e.key === "Escape") setTalkOpen(false); }} />
        <button class="btn sm" disabled=${!talkText.trim()} onClick=${sendTalk}>💩 Send</button>
      </div>`}

      ${bothOnline && html`<button class=${`reactfab ${canReact ? "" : "used"}`}
        title=${canReact ? "React" : "One per move 😉"}
        onClick=${() => canReact && setSheet(true)}>💗</button>`}

      ${sheet && html`<div class="reactsheet" onClick=${() => setSheet(false)}>
        <div class="reactgrid">
          ${["💗", "😂", "😱", "🔥", "😈", "👏", "🍑", "🧸"].map((e) =>
            html`<button key=${e} onClick=${(ev) => { ev.stopPropagation(); sendReact(e); }}>${e}</button>`)}
        </div>
        <div class="reactnote">one per move 😉</div>
      </div>`}

      ${floats.map((f) => html`<span key=${f.id} class="floatemoji" style=${`left:${f.x}%`}>${f.emoji}</span>`)}
    </div>`;
  }
  return html`<${ResumeCard} match=${match} me=${me} players=${players} onOpen=${() => setImmersive(true)} />`;
}

function ResumeCard({ match, me, players, onOpen }) {
  const s = match.state;
  const pinfo = (id) => players.find((p) => p.id === id) || { name: "?", emoji: "❔" };
  const oppId = s.players.find((p) => p !== me.id) || s.players[0];
  const yourTurn = s.status === "playing" && s.turn === me.id;
  let status;
  if (s.status === "matchOver") status = `${pinfo(s.winner).emoji} ${pinfo(s.winner).name} won 👑`;
  else if (s.status === "handOver") status = "Hand over — deal the next one";
  else status = yourTurn ? "Your turn" : `Waiting for ${pinfo(oppId).emoji} ${pinfo(oppId).name}`;
  return html`<div class="card gamehero" onClick=${onOpen}>
    <div class="eyebrow">Current game · Hand ${s.handNumber}</div>
    <div class="gamehero-title">${status}</div>
    <div class="gamehero-meta tnum">
      ${s.players.map((pid) => `${pinfo(pid).emoji} P${s.phaseOf[pid]} · ${s.scores[pid]}`).join("   ·   ")}
    </div>
    <button class="btn gamehero-btn" onClick=${(e) => { e.stopPropagation(); onOpen(); }}>${yourTurn ? "Play your turn" : "Open game"}</button>
  </div>`;
}

async function recordWin(client, api, winnerId) {
  await client.from("games").insert({ name: "Phase 10", status: "finished", winner_id: winnerId, finished_at: new Date().toISOString() });
}

function StartMatch({ players, client, onStarted, flash, room = null }) {
  const [sel, setSel] = useState(players.slice(0, 2).map((p) => p.id));
  const toggle = (id) => setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : (s.length < 2 ? [...s, id] : s));
  const start = async () => {
    if (sel.length !== 2) { flash("Pick exactly two players"); return; }
    const state = E.startMatch(sel);
    const { data, error } = await client.from("matches").insert({ state, version: 0, status: "playing", room }).select().single();
    if (error) { flash("⚠️ " + error.message); return; }
    onStarted(data);
  };
  return html`
    <div class="card">
      <h2>New Phase 10 match 🎴</h2>
      <p class="sub">Pick the two of you. The app deals real cards you can play from anywhere.</p>
      <div class="list">
        ${players.map((p) => html`<div class="line" key=${p.id} onClick=${() => toggle(p.id)}>
          <div class="l"><span class="em">${p.emoji}</span><b>${p.name}</b></div>
          <div class=${`chk ${sel.includes(p.id) ? "on" : ""}`}>${sel.includes(p.id) ? "✓" : ""}</div>
        </div>`)}
      </div>
      <button class="btn block mt" disabled=${sel.length !== 2} onClick=${start}>Deal first hand</button>
    </div>`;
}

/* ----------------------------------------------------------- Card --------- */
// Centre art per colour — four variants each, matched to the muted palette.
// A card's variant is hashed from its id, so the SAME card always wears the
// SAME art, on both phones, for the whole hand.
const CARD_ART = {
  red:    ["🌹", "🍎", "🍒", "🌶️"],
  blue:   ["🦋", "🌊", "🐬", "🫐"],
  green:  ["🍀", "🐸", "🌿", "🐢"],
  yellow: ["🌻", "🍋", "🐝", "⭐"],
};
function artFor(card) {
  const arts = CARD_ART[card.color];
  if (!arts) return null;
  let h = 0;
  for (let i = 0; i < card.id.length; i++) h = (h * 31 + card.id.charCodeAt(i)) >>> 0;
  return arts[h % arts.length];
}

function Card({ card, sel, onClick, small, cid, fan, dragging, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }) {
  let face, bg = "#fff", color = "#fff8f3";
  if (E.isNumber(card)) { bg = CARD_BG[card.color]; face = card.num; }
  else if (E.isWild(card)) { bg = "#2b2521"; color = "#e7c98a"; face = "★"; }      // ink card, gold star
  else { bg = "#8c8077"; color = "#fff8f3"; face = "⊘"; }                          // warm grey skip
  // Full-size cards show colour-matched emoji art in the centre; the number
  // lives in the corner. Small meld chips keep the number as the face — that's
  // how you read what's on a pile.
  const art = !small && E.isNumber(card) ? artFor(card) : null;
  const interactive = !!(onClick || onPointerDown);
  const f = fan || {};
  // Interactive cards are buttons; static ones (pile faces, meld chips) are
  // inert divs so taps PASS THROUGH to the pile/meld behind them. A disabled
  // button here used to swallow the tap on iOS/Android — you couldn't pick up
  // the discard because your finger always lands on the card art.
  const Tag = interactive ? "button" : "div";
  return html`<${Tag} data-cid=${cid} data-tf=${f.tf || ""}
    class=${`pcard ${small ? "sm" : ""} ${sel ? "sel" : ""} ${dragging ? "dragging" : ""} ${interactive ? "" : "static"}`}
    style=${`background:${bg};color:${color};${f.css || ""}`} onClick=${onClick}
    onPointerDown=${onPointerDown} onPointerMove=${onPointerMove} onPointerUp=${onPointerUp} onPointerCancel=${onPointerCancel}>
    ${!small && html`<span class="pcorner">${face}</span>`}${art ? html`<span class="cart">${art}</span>` : face}<//>`;
}

// Fan layout: one overlapping arched row, like cards held in a hand.
function fanOf(i, n, sel) {
  if (n <= 1) return { tf: "", css: "" };
  const c = i - (n - 1) / 2;
  const rot = c * Math.min(4.5, 34 / n);
  const arc = c * c * (n > 8 ? 0.6 : 1.2);
  const lift = sel ? -20 : 0;
  const overlap = n <= 6 ? -12 : n <= 8 ? -22 : n <= 10 ? -29 : n <= 12 ? -34 : -37;
  const tf = `rotate(${rot.toFixed(2)}deg) translateY(${(arc + lift).toFixed(1)}px)`;
  return { tf, css: `margin-left:${i === 0 ? 0 : overlap}px; z-index:${sel ? 99 : i + 1}; transform:${tf};` };
}

// Draggable fanned hand — GHOST architecture, built so a drag can never strand
// the layout:
// - the card you grab stays in flow (faded); a fixed-position GHOST clone
//   follows your finger with spring physics (lerp + velocity tilt)
// - the real card never receives inline transforms, so there is nothing to
//   get "stuck offset" — worst case the ghost is removed and all is normal
// - listeners live on WINDOW for the duration of the drag (element capture
//   dies when iOS interrupts a gesture); pointerup/cancel/blur/visibility all
//   end the drag, and a watchdog force-ends it if events stop arriving
// - on release the ghost glides into the card's slot, then evaporates
function Hand({ cards, flat, interactive, selectedId, onSelect, onReorder, canDropOnMeld, onDropOnMeld, canDropOnDiscard, onDropOnDiscard, canTargetMelds }) {
  const drag = useRef(null);
  const wrap = useRef(null);

  const endDrag = (glide) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    window.__ppDragging = false;
    window.removeEventListener("pointermove", d.onMove);
    window.removeEventListener("pointerup", d.onUp);
    window.removeEventListener("pointercancel", d.onCancel);
    window.removeEventListener("blur", d.onCancel);
    document.removeEventListener("visibilitychange", d.onVis);
    cancelAnimationFrame(d.raf);
    if (d.hoverEl) d.hoverEl.classList.remove("over");
    const ghost = d.ghost, el = d.el;
    if (el) el.classList.remove("lifted");
    if (ghost) {
      if (glide && el && document.contains(el)) {
        const r = el.getBoundingClientRect();
        ghost.style.transition = "transform .24s cubic-bezier(.2,.85,.3,1.12), opacity .24s ease";
        ghost.style.transform = `translate(${r.left}px, ${r.top}px) rotate(0deg) scale(1)`;
        ghost.style.opacity = "0";
        setTimeout(() => ghost.remove(), 260);
      } else ghost.remove();
    }
    // belt & braces: no orphaned ghosts, ever
    document.querySelectorAll(".dragghost").forEach((g) => { if (g !== ghost) g.remove(); });
  };

  // unmount safety
  useEffect(() => () => endDrag(false), []);

  const startGhost = (d) => {
    const r = d.el.getBoundingClientRect();
    d.grabX = d.x - r.left; d.grabY = d.y - r.top;
    d.px = r.left; d.py = r.top;
    const g = d.el.cloneNode(true);                       // keeps corner number + art
    g.className = "pcard dragghost";
    const cs = getComputedStyle(d.el);
    g.style.cssText = `background:${cs.backgroundColor}; color:${cs.color};` +
      `width:${d.el.offsetWidth}px; height:${d.el.offsetHeight}px;` +
      `transform: translate(${d.px}px, ${d.py}px);`;
    document.body.appendChild(g);
    d.ghost = g;
    d.el.classList.add("lifted");
  };

  // spring loop: ghost eases toward the finger; lag gives a natural tilt.
  // Doubles as the watchdog — if the OS stops sending events, end cleanly.
  const step = () => {
    const d = drag.current;
    if (!d || !d.moved) return;
    if (performance.now() - d.lastEvent > 1600) { endDrag(true); return; }
    const tx = d.cx - d.grabX, ty = d.cy - d.grabY;
    d.px += (tx - d.px) * 0.38;
    d.py += (ty - d.py) * 0.38;
    const tilt = Math.max(-10, Math.min(10, (tx - d.px) * 0.5));
    d.ghost.style.transform = `translate(${d.px.toFixed(1)}px, ${d.py.toFixed(1)}px) rotate(${tilt.toFixed(1)}deg) scale(1.07)`;
    d.raf = requestAnimationFrame(step);
  };

  const move = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.cx = e.clientX; d.cy = e.clientY; d.lastEvent = performance.now();
    if (!d.moved) {
      if (Math.hypot(d.cx - d.x, d.cy - d.y) <= 6) return;
      d.moved = true;
      window.__ppDragging = true;
      window.__ppDragSince = Date.now();
      startGhost(d);
      d.raf = requestAnimationFrame(step);
    }
    const under = document.elementFromPoint(d.cx, d.cy);   // ghost is pointer-events:none
    const dropEl = under && under.closest ? (under.closest("[data-meld]") || under.closest("[data-discard]")) : null;
    if (dropEl) {
      // hover feedback is validity-BLIND (house rule: legality glows are
      // hints). Zones react only by turn structure; the fit check happens
      // at release, where an illegal drop bounces home.
      const isDiscard = dropEl.hasAttribute("data-discard");
      const ok = isDiscard
        ? !!(canDropOnDiscard && canDropOnDiscard(d.id))
        : !!(canTargetMelds && canTargetMelds());
      if (d.hoverEl && d.hoverEl !== dropEl) d.hoverEl.classList.remove("over");
      d.hoverEl = ok ? dropEl : null;
      if (ok) dropEl.classList.add("over");
      return;
    }
    if (d.hoverEl) { d.hoverEl.classList.remove("over"); d.hoverEl = null; }
    // geometric insertion (row-aware; layout offsets ignore mid-slide transforms)
    const cont = wrap.current;
    if (!cont) return;
    const p = cont.getBoundingClientRect();
    const sibs = [...cont.querySelectorAll(".pcard")].filter((el) => el !== d.el);
    const to = sibs.reduce((acc, el) => {
      const cX = p.left + el.offsetLeft + el.offsetWidth / 2;
      const cY = p.top + el.offsetTop + el.offsetHeight / 2;
      const half = el.offsetHeight / 2 + 4;
      const before = (d.cy - cY > half) || (Math.abs(d.cy - cY) <= half && d.cx > cX);
      return acc + (before ? 1 : 0);
    }, 0);
    const cur = cards.findIndex((c) => c.id === d.id);
    if (to !== cur && cur >= 0) {
      const ids = cards.map((c) => c.id).filter((x) => x !== d.id);
      ids.splice(to, 0, d.id);
      try { navigator.vibrate && navigator.vibrate(8); } catch {}
      onReorder(ids);
    }
  };

  const up = (e) => {
    const d = drag.current;
    if (!d || (e && e.pointerId !== undefined && e.pointerId !== d.pointerId)) return;
    const { hoverEl, moved, id } = d;
    if (hoverEl) {
      const isDiscard = hoverEl.hasAttribute("data-discard");
      const owner = hoverEl.getAttribute("data-owner"), idx = +hoverEl.getAttribute("data-idx");
      const legal = isDiscard
        ? !!(canDropOnDiscard && canDropOnDiscard(id))
        : !!(canDropOnMeld && canDropOnMeld(id, owner, idx));
      if (legal) {
        endDrag(false);
        if (isDiscard) onDropOnDiscard && onDropOnDiscard(id);
        else onDropOnMeld && onDropOnMeld(id, owner, idx);
        return;
      }
      // doesn't fit: the pile shakes, the card glides back to the hand
      hoverEl.classList.add("nope");
      try { navigator.vibrate && navigator.vibrate(40); } catch {}
      setTimeout(() => hoverEl.classList.remove("nope"), 380);
      endDrag(true);
      return;
    }
    endDrag(true);
    if (!moved && interactive) onSelect(id);      // simple tap → select
  };

  const down = (e, id) => {
    if (drag.current) return;                     // one drag at a time
    const el = e.currentTarget;
    const d = { id, el, pointerId: e.pointerId, x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY,
      px: 0, py: 0, grabX: 0, grabY: 0, raf: 0, moved: false, hoverEl: null, ghost: null,
      lastEvent: performance.now() };
    d.onMove = move;
    d.onUp = up;
    d.onCancel = () => endDrag(true);
    d.onVis = () => { if (document.visibilityState !== "visible") endDrag(false); };
    drag.current = d;
    // window-level listeners survive element churn and iOS gesture interrupts
    window.addEventListener("pointermove", d.onMove);
    window.addEventListener("pointerup", d.onUp);
    window.addEventListener("pointercancel", d.onCancel);
    window.addEventListener("blur", d.onCancel);
    document.addEventListener("visibilitychange", d.onVis);
  };

  return html`<div ref=${wrap} class=${`hand ${flat ? "flat" : ""}`}>
    ${cards.map((c, i) => html`<${Card} key=${c.id} card=${c} cid=${c.id} sel=${selectedId === c.id}
      fan=${flat ? null : fanOf(i, cards.length, selectedId === c.id)}
      onPointerDown=${(e) => down(e, c.id)} />`)}
  </div>`;
}

// 💩 per-hand chat bubbles — fills the dead space between the piles and your
// hand; scrolls smoothly, auto-follows the newest message.
function TalkStrip({ talk, meId, pinfo }) {
  const ref = useRef(null);
  const first = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // jump on first paint, glide on every message after
    el.scrollTo({ top: el.scrollHeight, behavior: first.current ? "auto" : "smooth" });
    first.current = false;
  }, [talk.length]);
  if (!talk.length) return null;
  return html`<div class="talkstrip" ref=${ref}>
    ${talk.map((m) => html`<div class=${`tbub ${m.player_id === meId ? "mine" : ""} ${m.pending ? "pending" : ""}`} key=${m.id}>
      ${m.player_id !== meId && html`<span class="tb-who">${pinfo(m.player_id).emoji}</span>`}
      <span class="tb-txt">${m.text}</span>
    </div>`)}
  </div>`;
}

// Melds NEVER advertise whether a card fits (house rule: that's a hint).
// With a card selected, tapping any meld ATTEMPTS the hit — illegal gets a
// shake, legal just plays. You learn legality by committing, like a real table.
function Meld({ meld, targetable, onHit, owner, idx }) {
  const ref = useRef(null);
  const tap = () => {
    if (!onHit) return;
    if (!onHit() && ref.current) {
      const el = ref.current;
      el.classList.add("nope");
      try { navigator.vibrate && navigator.vibrate(40); } catch {}
      setTimeout(() => el.classList.remove("nope"), 380);
    }
  };
  return html`<div ref=${ref} class="meld" onClick=${targetable ? tap : null}
    data-meld="1" data-owner=${owner} data-idx=${idx}>
    ${meld.cards.map((c) => html`<${Card} key=${c.id} card=${c} small=${true} />`)}
  </div>`;
}

/* ----------------------------------------------------------- Board -------- */
function Board(props) {
  const { match, commit, players, me, oppOnline } = props;
  const s = match.state;
  const meId = me.id;
  const oppId = s.players.find((p) => p !== meId) || s.players[0];
  const pinfo = (id) => players.find((p) => p.id === id) || { name: "?", emoji: "❔", color: "#999" };
  const myTurn = s.turn === meId && s.status === "playing";

  const [mode, setMode] = useState("normal"); // normal | laying
  const [pick, setPick] = useState(null);      // selected hand card id (discard/hit)
  useEffect(() => { setMode("normal"); setPick(null); }, [s.turn, s.turnPhase, s.status, s.handNumber]);

  const [showPhases, setShowPhases] = useState(false);  // 📋 all-phases sheet

  // Hand view: fan (default) or simple row layout. Per-device preference.
  const [flatHand, setFlatHand] = useState(() => localStorage.getItem("pp.flatHand") === "1");
  const toggleFlat = () => setFlatHand((v) => { const n = !v; try { localStorage.setItem("pp.flatHand", n ? "1" : "0"); } catch {} return n; });

  // POW 💥 — when anyone lays down their phase, slam the melds onto the table:
  // screenshake + aggressive card landing + dust. Fires on whichever phone is
  // watching when the state lands (the slammer immediately, the partner via
  // realtime). Only on the false→true transition, never on mount.
  const [slam, setSlam] = useState(null);
  const prevLaid = useRef({});
  useEffect(() => {
    let t;
    for (const pid of s.players) {
      if (s.laidDown[pid] && prevLaid.current[pid] === false) {
        setSlam(pid);
        try { navigator.vibrate && navigator.vibrate([90, 40, 130]); } catch {}
        t = setTimeout(() => setSlam(null), 950);
      }
    }
    prevLaid.current = { ...s.laidDown };
    return () => clearTimeout(t);
  }, [s.laidDown[s.players[0]], s.laidDown[s.players[1]]]);

  // Live turn change: when it becomes my turn while I'm watching, buzz the
  // phone (where supported) — the GO badge pop animation covers the eyes.
  const wasMyTurn = useRef(myTurn);
  useEffect(() => {
    if (myTurn && !wasMyTurn.current) { try { navigator.vibrate && navigator.vibrate([60, 40, 60]); } catch {} }
    wasMyTurn.current = myTurn;
  }, [myTurn]);

  // Skip awareness: a SKIPPED badge shows for the whole bonus turn (from
  // s.skipInfo), and the victim gets a toast the moment it lands.
  const skipSeq = s.skipInfo?.seq || 0;
  const seenSkip = useRef(skipSeq);
  useEffect(() => {
    if (skipSeq !== seenSkip.current) {
      seenSkip.current = skipSeq;
      if (s.skipInfo?.victim === meId) props.flash(`⊘ ${pinfo(s.skipInfo.by).emoji} ${pinfo(s.skipInfo.by).name} skipped you — they go again`);
    }
  }, [skipSeq]);

  // The player's own hand arrangement (persisted per device). Cards are NOT
  // auto-sorted: a freshly dealt hand starts tidy, then keeps whatever order the
  // player drags it into; newly drawn cards append to the end.
  const handCards = s.hands[meId] || [];
  const orderKey = `pp.order.${match.id}.${meId}`;
  const [order, setOrder] = useState(() => { try { return JSON.parse(localStorage.getItem(orderKey) || "[]"); } catch { return []; } });
  const setOrderSaved = (ids) => { setOrder(ids); try { localStorage.setItem(orderKey, JSON.stringify(ids)); } catch {} };
  const myHand = useMemo(() => {
    const byId = Object.fromEntries(handCards.map((c) => [c.id, c]));
    const present = new Set(handCards.map((c) => c.id));
    const kept = order.filter((id) => present.has(id));
    const ids = (kept.length === 0 && handCards.length)
      ? E.sortHand(handCards).map((c) => c.id)                                       // fresh hand → tidy default
      : [...kept, ...handCards.filter((c) => !kept.includes(c.id)).map((c) => c.id)]; // keep arrangement, append draws
    return ids.map((id) => byId[id]);
  }, [handCards, order]);
  const me_ = pinfo(meId), opp_ = pinfo(oppId);

  // ---- hand over / match over panels ----
  if (s.status === "handOver") return html`<${HandOver} ...${props} oppId=${oppId} pinfo=${pinfo} />`;
  if (s.status === "matchOver") return html`<${MatchOver} ...${props} pinfo=${pinfo} />`;

  const draw = (src) => commit(E.drawFrom(s, meId, src));
  const doDiscard = () => { if (pick) commit(E.discard(s, meId, pick)); };
  // returns whether the hit was legal — the meld shakes itself on false
  const doHit = (ownerId, idx) => {
    if (!pick) return false;
    const card = (s.hands[meId] || []).find((c) => c.id === pick);
    const meld = (s.table[ownerId] || [])[idx];
    if (!(card && meld && E.canHit(meld, card))) return false;
    commit(E.hit(s, meId, pick, ownerId, idx));
    setPick(null);
    return true;
  };

  // Drag-a-card-onto-a-pile: legal only on your play step, after laying down,
  // and when the engine says the card fits that pile (wilds just work).
  const canDropOnMeld = (cardId, owner, idx) => {
    if (!(myTurn && s.turnPhase === "play" && s.laidDown[meId])) return false;
    const card = (s.hands[meId] || []).find((c) => c.id === cardId);
    const meld = (s.table[owner] || [])[idx];
    return !!(card && meld && E.canHit(meld, card));
  };
  const onDropOnMeld = (cardId, owner, idx) => {
    if (!canDropOnMeld(cardId, owner, idx)) return;
    setPick(null);
    commit(E.hit(s, meId, cardId, owner, idx));
  };

  // Discard pile is also a drop target: drag any card onto it to end your turn.
  const canDropOnDiscard = () => myTurn && s.turnPhase === "play";
  const onDropOnDiscard = (cardId) => {
    if (!canDropOnDiscard()) return;
    setPick(null);
    commit(E.discard(s, meId, cardId));
  };

  // With a card selected, melds become tappable TARGETS — but never reveal
  // whether the card fits. Targetable = turn structure only, no E.canHit.
  const pickedCard = pick ? myHand.find((c) => c.id === pick) : null;
  const tapTargetable = !!pickedCard && myTurn && s.turnPhase === "play" && s.laidDown[meId];

  const topDiscard = s.discard[s.discard.length - 1];
  const discardIsSkip = topDiscard && E.isSkip(topDiscard);
  const goingOut = myHand.length === 1;
  const discardLabel = pickedCard
    ? (E.isSkip(pickedCard) ? "Play Skip ⊘" : goingOut ? "Go out 🎉" : "Discard")
    : null;

  return html`
    <div class=${`board ${slam ? "quake" : ""}`}>
      <!-- opponent zone -->
      <div class="zone opp">
        <div class="pname">
          ${oppOnline && html`<span class="wavehand" title="online now">👋</span>`}
          <span class="nm">${opp_.emoji} ${opp_.name}</span>
          ${s.turn === oppId && s.status === "playing" && html`<span class="gobadge">GO</span>`}
          ${s.skipInfo?.victim === oppId && html`<span class="gobadge skipd">⊘ SKIPPED</span>`}
        </div>
        <div class="microstat">P${s.phaseOf[oppId]} · ${s.scores[oppId]} · ${(s.hands[oppId] || []).length} cards</div>
        ${(s.table[oppId] || []).length > 0 && html`<div class=${`melds ${slam === oppId ? "slam" : ""}`}>
          ${s.table[oppId].map((m, i) => html`<${Meld} key=${i} meld=${m} owner=${oppId} idx=${i}
            targetable=${tapTargetable} onHit=${() => doHit(oppId, i)} />`)}
        </div>`}
      </div>

      <!-- piles band -->
      <div class="zone center">
        <div class="piles">
          <button class=${`pile lg draw ${myTurn && s.turnPhase === "draw" ? "live" : ""}`}
            disabled=${!(myTurn && s.turnPhase === "draw")} onClick=${() => draw("pile")}>
            <div class="deckstack"><div class="pcardback">🂠</div></div>
            <div class="pilelbl">${s.draw.length}</div>
          </button>
          <button class=${`pile lg ${myTurn && s.turnPhase === "draw" && !discardIsSkip ? "live" : ""}`}
            data-discard="1"
            disabled=${!(myTurn && s.turnPhase === "draw" && !discardIsSkip)} onClick=${() => draw("discard")}>
            ${topDiscard ? html`<${Card} card=${topDiscard} />` : html`<div class="pcardback">—</div>`}
            <div class="pilelbl"> </div>
          </button>
        </div>
      </div>

      <!-- my zone -->
      <div class="zone mine">
        <${TalkStrip} talk=${props.talk || []} meId=${meId} pinfo=${pinfo} />
        ${(s.table[meId] || []).length > 0 && html`<div class=${`melds ${slam === meId ? "slam" : ""}`}>
          ${s.table[meId].map((m, i) => html`<${Meld} key=${i} meld=${m} owner=${meId} idx=${i}
            targetable=${tapTargetable} onHit=${() => doHit(meId, i)} />`)}
        </div>`}

        ${mode === "laying"
          ? html`<${LayDown} state=${s} meId=${meId} hand=${myHand} flat=${flatHand} commit=${commit} cancel=${() => setMode("normal")} />`
          : html`
          ${myTurn && s.turnPhase === "play" && html`
            ${pickedCard
              ? html`<button class="bigpill act" onClick=${doDiscard}>${discardLabel}</button>`
              : !s.laidDown[meId]
                ? html`<button class="bigpill" onClick=${() => setMode("laying")}>Phase ${s.phaseOf[meId]} · ${E.phaseText(s.phaseOf[meId])}</button>`
                : null}
          `}
          <${Hand} cards=${myHand} flat=${flatHand} interactive=${myTurn && s.turnPhase === "play"}
            selectedId=${pick} onSelect=${(id) => setPick(pick === id ? null : id)} onReorder=${setOrderSaved}
            canDropOnMeld=${canDropOnMeld} onDropOnMeld=${onDropOnMeld} canTargetMelds=${() => myTurn && s.turnPhase === "play" && !!s.laidDown[meId]}
            canDropOnDiscard=${canDropOnDiscard} onDropOnDiscard=${onDropOnDiscard} />
          <div class="phasereq">${s.laidDown[meId]
            ? html`${E.phaseText(s.phaseOf[meId])} <b>✓</b>`
            : html`need: <b>${E.phaseText(s.phaseOf[meId])}</b>`}</div>
          <div class="pname me">
            <button class="linkbtn micro" title="All 10 phases" onClick=${() => setShowPhases(true)}>📋</button>
            <span class="nm">${me_.emoji} ${me_.name}</span>
            ${myTurn && html`<span class="gobadge">GO</span>`}
            ${s.skipInfo?.victim === meId && html`<span class="gobadge skipd">⊘ SKIPPED</span>`}
            <button class=${`linkbtn micro viewtoggle ${flatHand ? "on" : ""}`} title="Fan / row view" onClick=${toggleFlat}>▦</button>
          </div>
          <div class="microstat">P${s.phaseOf[meId]} · ${s.scores[meId]}${s.laidDown[meId] ? " · down ✓" : ""}</div>
        `}
      </div>

      ${showPhases && html`<div class="modal-bg phasesheet" onClick=${(e) => { if (e.target.classList.contains("modal-bg")) setShowPhases(false); }}>
        <div class="modal">
          <div class="handle"></div>
          <h3>The 10 phases</h3>
          <div class="list">
            ${E.PHASES.map((p, i) => {
              const n = i + 1;
              const bothPast = s.players.every((pid) => s.phaseOf[pid] > n);
              return html`<div class=${`line ${bothPast ? "dim" : ""}`} key=${n}>
                <div class="l"><span class="phn">${n}</span><b>${p.text}</b></div>
                <div class="row">
                  ${s.players.map((pid) => s.phaseOf[pid] === n
                    ? html`<span class=${`pill ${pid === meId ? "open" : ""}`}>${pinfo(pid).emoji}${s.laidDown[pid] ? " ✓" : ""}</span>`
                    : null)}
                </div>
              </div>`;
            })}
          </div>
        </div>
      </div>`}
    </div>`;
}

/* ----------------------------------------------------------- LayDown ------ */
// Build your phase by tapping cards into slots. Tap a card already in a slot to
// pull it back (so you can freely re-place wilds). Slots auto-advance.
function LayDown({ state, meId, hand, flat, commit, cancel }) {
  const phase = state.phaseOf[meId];
  const groups = E.phaseGroups(phase);
  const [assign, setAssign] = useState(groups.map(() => []));   // card ids per slot
  const [active, setActive] = useState(0);
  const cardById = useMemo(() => Object.fromEntries(hand.map((c) => [c.id, c])), [hand]);
  const usedAll = new Set(assign.flat());
  const groupsCards = assign.map((ids) => ids.map((id) => cardById[id]).filter(Boolean));
  const groupOk = groups.map((g, i) => E.validGroup(g, groupsCards[i]));
  const ok = E.validPhase(phase, groupsCards);

  const addCard = (id) => setAssign((a) => {
    if (a.flat().includes(id)) return a;
    const card = cardById[id];
    let ai = active;
    if (a[ai].length >= groups[ai].count) {
      // Active slot already meets its minimum. If this card legally EXTENDS it
      // (a 4th five on a set of 5s, the next card of a run, a wild), keep it
      // here — you may lay down more than the phase requires. Otherwise move
      // on to the next unfilled slot.
      const cur = a[ai].map((x) => cardById[x]).filter(Boolean);
      const extends_ = E.validGroup(groups[ai], cur) &&
        E.validGroup({ ...groups[ai], count: cur.length + 1 }, [...cur, card]);
      if (!extends_) {
        const next = groups.findIndex((g, k) => a[k].length < g.count);
        if (next >= 0) ai = next;               // fill remaining minimums first
      }
    }
    if (ai !== active) setActive(ai);
    return a.map((g, i) => (i === ai ? [...g, id] : g));
  });
  const removeCard = (id) => setAssign((a) => a.map((g) => g.filter((x) => x !== id)));
  const tapHandCard = (id) => (usedAll.has(id) ? removeCard(id) : addCard(id));

  return html`<div class="laydown">
    <div class="row between">
      <b>Phase ${phase}</b>
      <button class="linkbtn" onClick=${cancel}>✕</button>
    </div>
    <div class="buckets">
      ${groups.map((g, i) => html`<div class=${`bucket ${active === i ? "on" : ""} ${groupOk[i] ? "good" : ""}`}
        key=${i} onClick=${() => setActive(i)}>
        <div class="brow"><span>${g.type === "set" ? "Set" : g.type === "run" ? "Run" : "Colour"} of ${g.count}</span>
          <span class="bc">${assign[i].length}/${g.count}${groupOk[i] ? " ✓" : ""}</span></div>
        <div class="bchips">
          ${groupsCards[i].map((c) => html`<${Card} key=${c.id} card=${c} small=${true}
            onClick=${(e) => { if (e && e.stopPropagation) e.stopPropagation(); removeCard(c.id); }} />`)}
        </div>
      </div>`)}
    </div>
    <div class=${`hand ${flat ? "flat" : ""}`}>
      ${hand.map((c, i) => html`<${Card} key=${c.id} card=${c} sel=${usedAll.has(c.id)}
        fan=${flat ? null : fanOf(i, hand.length, usedAll.has(c.id))} onClick=${() => tapHandCard(c.id)} />`)}
    </div>
    <button class="btn good block mt" disabled=${!ok}
      onClick=${() => { commit(E.layDown(state, meId, assign)); cancel(); }}>
      Lay down${ok ? " ✓" : ""}
    </button>
  </div>`;
}

/* ----------------------------------------------------------- HandOver ----- */
function HandOver({ match, commit, pinfo, oppId, me }) {
  const s = match.state;
  const d = s.lastHand?.detail || {};
  const outName = s.lastHand ? pinfo(s.lastHand.outPid).name : "";
  return html`<div class="card">
    <h2>Hand ${s.lastHand?.handNumber} over 🏁</h2>
    <p class="sub">${pinfo(s.lastHand?.outPid).emoji} ${outName} went out.</p>
    <div class="list">
      ${s.players.map((p) => { const x = d[p] || {}; const info = pinfo(p);
        return html`<div class="line" key=${p}>
          <div class="l"><span class="em">${info.emoji}</span><div class="txt"><b>${info.name}</b>
            <span class="tiny muted">${x.laid ? `completed phase ${x.fromPhase} → now on ${Math.min(x.fromPhase + 1, 10)}` : `still on phase ${x.fromPhase}`}</span></div></div>
          <div class="row"><span class="amt neg">+${x.points}</span><span class="pill">total ${s.scores[p]}</span></div>
        </div>`; })}
    </div>
    <button class="btn block mt" onClick=${() => commit(E.startHand(s))}>Deal next hand 🎴</button>
  </div>`;
}

/* ----------------------------------------------------------- MatchOver ---- */
function MatchOver({ match, setMatch, players, me, pinfo, client, flash, room = null }) {
  const s = match.state;
  const w = pinfo(s.winner);
  const newMatch = async () => {
    const state = E.startMatch(s.players);
    await client.from("matches").update({ status: "finished" }).eq("id", match.id);
    const { data, error } = await client.from("matches").insert({ state, version: 0, status: "playing", room }).select().single();
    if (error) { flash("⚠️ " + error.message); return; }
    setMatch(data); // realtime swaps the other phone to the fresh match too
  };
  return html`<div class="card center">
    <div style="font-size:54px">👑</div>
    <h2 style="margin:.2em 0">${w.emoji} ${w.name} wins!</h2>
    <p class="sub">Finished all 10 phases.</p>
    <div class="list" style="text-align:left">
      ${[...s.players].sort((a, b) => s.scores[a] - s.scores[b]).map((p) => { const info = pinfo(p);
        return html`<div class="line" key=${p}>
          <div class="l"><span class="em">${info.emoji}</span><b>${info.name}</b></div>
          <div class="row"><span class="pill">phase ${s.phaseOf[p]}</span><span class="amt">${s.scores[p]} pts</span></div>
        </div>`; })}
    </div>
    <p class="tiny muted mt">🏆 logged to Lifetime · trophy hearts granted</p>
    <button class="btn block mt" onClick=${newMatch}>New match 🎴</button>
  </div>`;
}
