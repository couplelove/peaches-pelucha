import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useMemo, useCallback, useRef } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import * as E from "./engine.js";

const html = htm.bind(h);

// Muted, editorial card colours — distinguishable but not candy.
const CARD_BG = { red: "#bf4a3c", blue: "#356b8c", green: "#3e7a58", yellow: "#b0822c" };

/* ----------------------------------------------------------- match hook --- */
function useMatch(client) {
  const [match, setMatch] = useState(undefined); // undefined=loading, null=none
  const load = useCallback(async () => {
    const { data } = await client.from("matches").select("*")
      .eq("status", "playing").order("created_at", { ascending: false }).limit(1);
    setMatch((data && data[0]) || null);
  }, [client]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const ch = client.channel("pp-match")
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, (p) => {
        if (p.eventType === "DELETE") { load(); return; }
        const row = p.new;
        if (row.status === "playing") setMatch(row);
        else load();
      }).subscribe();
    return () => { client.removeChannel(ch); };
  }, [client, load]);
  return [match, setMatch, load];
}

/* ----------------------------------------------------------- PlayTab ------ */
export function PlayTab(ctx) {
  const { client, players, me, api, flash } = ctx;
  const [match, setMatch, reload] = useMatch(client);
  const [immersive, setImmersive] = useState(true);  // live hand plays full-screen
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
  }, [match, client, api, flash, reload, setMatch]);

  if (match === undefined) {
    return html`<div class="card center"><div class="muted">Loading game…</div></div>`;
  }
  if (match === null) {
    return html`<${StartMatch} players=${players} client=${client} onStarted=${(row) => { setMatch(row); setImmersive(true); }} flash=${flash} />`;
  }
  // The live hand plays full-screen (no menus). "‹ Menu" pops back to the tabbed
  // app, where this same tab shows a compact Resume card.
  if (immersive) {
    return html`<div class="gamefs">
      <div class="gamefs-bar">
        <button class="btn ghost sm" onClick=${() => setImmersive(false)}>‹ Menu</button>
        <div class="gamefs-title">🍑 Phase 10 🧸</div>
        <span style="width:64px"></span>
      </div>
      <div class="gamefs-body">
        <${Board} ...${ctx} match=${match} commit=${commit} setMatch=${setMatch} />
      </div>
    </div>`;
  }
  return html`<${ResumeCard} match=${match} me=${me} players=${players} onOpen=${() => setImmersive(true)} />`;
}

function ResumeCard({ match, me, players, onOpen }) {
  const s = match.state;
  const pinfo = (id) => players.find((p) => p.id === id) || { name: "?", emoji: "❔" };
  const oppId = s.players.find((p) => p !== me.id) || s.players[0];
  let status;
  if (s.status === "matchOver") status = `${pinfo(s.winner).emoji} ${pinfo(s.winner).name} won 👑`;
  else if (s.status === "handOver") status = "Hand over — deal the next one";
  else status = s.turn === me.id ? "Your turn" : `Waiting for ${pinfo(oppId).emoji} ${pinfo(oppId).name}`;
  return html`<div class="card">
    <div class="row between">
      <div>
        <div class="eyebrow">Phase 10 · Hand ${s.handNumber}</div>
        <div class="ghand" style="margin-top:4px">${status}</div>
      </div>
      <button class="btn" onClick=${onOpen}>Open game</button>
    </div>
  </div>`;
}

async function recordWin(client, api, winnerId) {
  await client.from("games").insert({ name: "Phase 10", status: "finished", winner_id: winnerId, finished_at: new Date().toISOString() });
}

function StartMatch({ players, client, onStarted, flash }) {
  const [sel, setSel] = useState(players.slice(0, 2).map((p) => p.id));
  const toggle = (id) => setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : (s.length < 2 ? [...s, id] : s));
  const start = async () => {
    if (sel.length !== 2) { flash("Pick exactly two players"); return; }
    const state = E.startMatch(sel);
    const { data, error } = await client.from("matches").insert({ state, version: 0, status: "playing" }).select().single();
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
function Card({ card, sel, onClick, small, cid, onPointerDown, onPointerMove, onPointerUp }) {
  let face, bg = "#fff", color = "#fff8f3";
  if (E.isNumber(card)) { bg = CARD_BG[card.color]; face = card.num; }
  else if (E.isWild(card)) { bg = "#2b2521"; color = "#e7c98a"; face = "★"; }      // ink card, gold star
  else { bg = "#8c8077"; color = "#fff8f3"; face = "⊘"; }                          // warm grey skip
  const interactive = !!(onClick || onPointerDown);
  return html`<button data-cid=${cid}
    class=${`pcard ${small ? "sm" : ""} ${sel ? "sel" : ""} ${interactive ? "" : "static"}`}
    style=${`background:${bg};color:${color}`} onClick=${onClick} disabled=${!interactive}
    onPointerDown=${onPointerDown} onPointerMove=${onPointerMove} onPointerUp=${onPointerUp}>${face}</button>`;
}

// Draggable hand: tap a card to select it, drag it to rearrange. Order is the
// player's own (never force-sorted); Shuffle / Sort are opt-in.
function Hand({ cards, interactive, selectedId, onSelect, onReorder }) {
  const drag = useRef({ id: null, x: 0, y: 0, moved: false, reordered: false });
  const down = (e, id) => {
    drag.current = { id, x: e.clientX, y: e.clientY, moved: false, reordered: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  };
  const move = (e) => {
    const d = drag.current;
    if (!d.id) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) d.moved = true;
    if (!d.moved) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const t = el && el.closest ? el.closest("[data-cid]") : null;
    const tid = t && t.getAttribute("data-cid");
    if (tid && tid !== d.id) {
      const ids = cards.map((c) => c.id);
      const from = ids.indexOf(d.id), to = ids.indexOf(tid);
      if (from >= 0 && to >= 0) { const n = [...ids]; n.splice(from, 1); n.splice(to, 0, d.id); d.reordered = true; onReorder(n); }
    }
  };
  const up = () => {
    const d = drag.current;
    // A gesture that never reordered another card counts as a tap → select it.
    if (d.id && !d.reordered && interactive) onSelect(d.id);
    drag.current = { id: null, x: 0, y: 0, moved: false, reordered: false };
  };
  return html`<div class="hand">
    ${cards.map((c) => html`<${Card} key=${c.id} card=${c} cid=${c.id} sel=${selectedId === c.id}
      onPointerDown=${(e) => down(e, c.id)} onPointerMove=${move} onPointerUp=${up} />`)}
  </div>`;
}

function Meld({ meld, hittable, onHit }) {
  return html`<div class=${`meld ${hittable ? "hit" : ""}`} onClick=${hittable ? onHit : null}>
    ${meld.cards.map((c) => html`<${Card} key=${c.id} card=${c} small=${true} />`)}
    ${hittable && html`<span class="hitplus">＋</span>`}
  </div>`;
}

/* ----------------------------------------------------------- Board -------- */
function Board(props) {
  const { match, commit, players, me } = props;
  const s = match.state;
  const meId = me.id;
  const oppId = s.players.find((p) => p !== meId) || s.players[0];
  const pinfo = (id) => players.find((p) => p.id === id) || { name: "?", emoji: "❔", color: "#999" };
  const myTurn = s.turn === meId && s.status === "playing";

  const [mode, setMode] = useState("normal"); // normal | laying | hitting
  const [pick, setPick] = useState(null);      // selected hand card id (discard/hit)
  useEffect(() => { setMode("normal"); setPick(null); }, [s.turn, s.turnPhase, s.status, s.handNumber]);

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
  const doHit = (ownerId, idx) => { if (pick) { commit(E.hit(s, meId, pick, ownerId, idx)); setPick(null); } };

  const topDiscard = s.discard[s.discard.length - 1];
  const discardIsSkip = topDiscard && E.isSkip(topDiscard);

  return html`
    <div class="card game">
      <div class="row between">
        <div class="ghand">Hand ${s.handNumber}</div>
        <div class=${`turnbadge ${myTurn ? "you" : "them"}`}>
          ${s.turn === meId ? "Your turn" : `${opp_.emoji} ${opp_.name}'s turn`}
        </div>
      </div>

      <!-- opponent -->
      <${PlayerStrip} info=${opp_} phase=${s.phaseOf[oppId]} score=${s.scores[oppId]}
        handCount=${(s.hands[oppId] || []).length} laid=${s.laidDown[oppId]} skip=${!!s.skipped[oppId]} mine=${false} />
      ${(s.table[oppId] || []).length > 0 && html`<div class="melds">
        ${s.table[oppId].map((m, i) => html`<${Meld} key=${i} meld=${m}
          hittable=${mode === "hitting" && !!pick && E.canHit(m, myHand.find((c) => c.id === pick))}
          onHit=${() => doHit(oppId, i)} />`)}
      </div>`}

      <!-- piles -->
      <div class="piles">
        <button class=${`pile draw ${myTurn && s.turnPhase === "draw" ? "live" : ""}`}
          disabled=${!(myTurn && s.turnPhase === "draw")} onClick=${() => draw("pile")}>
          <div class="pcardback">🂠</div><div class="pilelbl">Draw · ${s.draw.length}</div>
        </button>
        <button class=${`pile ${myTurn && s.turnPhase === "draw" && !discardIsSkip ? "live" : ""}`}
          disabled=${!(myTurn && s.turnPhase === "draw" && !discardIsSkip)} onClick=${() => draw("discard")}>
          ${topDiscard ? html`<${Card} card=${topDiscard} />` : html`<div class="pcardback">—</div>`}
          <div class="pilelbl">${discardIsSkip ? "Skip (can't take)" : "Discard"}</div>
        </button>
      </div>

      <!-- my melds -->
      ${(s.table[meId] || []).length > 0 && html`<div class="melds mine">
        ${s.table[meId].map((m, i) => html`<${Meld} key=${i} meld=${m}
          hittable=${mode === "hitting" && !!pick && E.canHit(m, myHand.find((c) => c.id === pick))}
          onHit=${() => doHit(meId, i)} />`)}
      </div>`}

      <!-- me -->
      <${PlayerStrip} info=${me_} phase=${s.phaseOf[meId]} score=${s.scores[meId]}
        handCount=${myHand.length} laid=${s.laidDown[meId]} skip=${!!s.skipped[meId]} mine=${true} />

      ${mode === "laying"
        ? html`<${LayDown} state=${s} meId=${meId} hand=${myHand} commit=${commit} cancel=${() => setMode("normal")} />`
        : html`
        <div class="phasereq">Your phase ${s.phaseOf[meId]}: <b>${E.phaseText(s.phaseOf[meId])}</b></div>
        <div class="handbar">
          <span class="hint" style="margin:0">drag to rearrange</span>
          <div class="row">
            <button class="linkbtn" onClick=${() => setOrderSaved(E.shuffle(handCards).map((c) => c.id))}>🔀 Shuffle</button>
            <button class="linkbtn" onClick=${() => setOrderSaved(E.sortHand(handCards).map((c) => c.id))}>⇅ Sort</button>
          </div>
        </div>
        <${Hand} cards=${myHand} interactive=${myTurn && s.turnPhase === "play"}
          selectedId=${pick} onSelect=${(id) => setPick(pick === id ? null : id)} onReorder=${setOrderSaved} />

        ${!myTurn && html`<div class="waitbar">⏳ Waiting for ${opp_.emoji} ${opp_.name}…</div>`}
        ${myTurn && s.turnPhase === "draw" && html`<div class="waitbar">👆 Your turn — tap the deck or the discard pile to draw</div>`}
        ${myTurn && s.turnPhase === "play" && (() => {
          const picked = myHand.find((c) => c.id === pick);
          const goingOut = myHand.length === 1;   // discarding the last card wins the hand
          const discardLabel = !pick ? "Tap a card to discard"
            : E.isSkip(picked) ? "Play Skip ⊘ — end turn"
            : goingOut ? "Discard & go out 🎉"
            : "Discard — end turn";
          return html`
          <div class="actionbar">
            ${!s.laidDown[meId] && html`<button class="btn ghost sm" onClick=${() => setMode("laying")}>📋 Lay down phase</button>`}
            ${s.laidDown[meId] && html`<button class=${`btn ghost sm ${mode === "hitting" ? "on" : ""}`}
              onClick=${() => setMode(mode === "hitting" ? "normal" : "hitting")}>${mode === "hitting" ? "Done hitting" : "✋ Hit a meld"}</button>`}
          </div>
          ${mode === "hitting"
            ? html`<div class="hint">Tap one of your cards, then tap a glowing meld to add it. Tap “Done hitting” when finished.</div>`
            : html`
              <button class="btn block discardbtn ${pick ? "" : "wait"}" disabled=${!pick} onClick=${doDiscard}>${discardLabel}</button>
              <div class="hint">${s.laidDown[meId]
                ? "You’ve laid down. Discard a card to end your turn."
                : "Optional: lay down your phase. To finish, tap a card and discard."}</div>
            `}`;
        })()}
      `}

      <${LogStrip} log=${s.log} pinfo=${pinfo} oppId=${oppId} meId=${meId} />
    </div>`;
}

function PlayerStrip({ info, phase, score, handCount, laid, skip, mine }) {
  return html`<div class=${`pstrip ${mine ? "mine" : ""}`} style=${`border-color:${info.color}55`}>
    <div class="l"><span class="av" style=${`background:${info.color}22`}>${info.emoji}</span>
      <div><b>${info.name}${mine ? " (you)" : ""}</b>
        <div class="tiny muted">Phase ${phase} · ${handCount} cards${laid ? " · laid down ✓" : ""}${skip ? " · skipped ⊘" : ""}</div></div></div>
    <div class="score">${score}</div>
  </div>`;
}

function LogStrip({ log, pinfo, oppId, meId }) {
  const last = (log || []).slice(-1)[0];
  if (!last) return null;
  return html`<div class="logstrip tiny muted">📝 ${last}</div>`;
}

/* ----------------------------------------------------------- LayDown ------ */
// Build your phase by tapping cards into slots. Tap a card already in a slot to
// pull it back (so you can freely re-place wilds). Slots auto-advance.
function LayDown({ state, meId, hand, commit, cancel }) {
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
    let ai = active;
    if (a[ai].length >= groups[ai].count) ai = groups.findIndex((g, k) => a[k].length < g.count);
    if (ai < 0) return a;                       // every slot full
    if (ai !== active) setActive(ai);
    return a.map((g, i) => (i === ai ? [...g, id] : g));
  });
  const removeCard = (id) => setAssign((a) => a.map((g) => g.filter((x) => x !== id)));
  const tapHandCard = (id) => (usedAll.has(id) ? removeCard(id) : addCard(id));

  return html`<div class="laydown">
    <div class="row between">
      <b>Lay down phase ${phase}</b>
      <button class="linkbtn" onClick=${cancel}>Cancel</button>
    </div>
    <div class="hint" style="margin:2px 0 10px">${E.phaseText(phase)}. Tap a slot, then tap cards — tap a card in a slot to take it back.</div>
    <div class="buckets">
      ${groups.map((g, i) => html`<div class=${`bucket ${active === i ? "on" : ""} ${groupOk[i] ? "good" : ""}`}
        key=${i} onClick=${() => setActive(i)}>
        <div class="brow"><span>${g.type === "set" ? "Set" : g.type === "run" ? "Run" : "Colour"} of ${g.count}</span>
          <span class="bc">${assign[i].length}/${g.count}${groupOk[i] ? " ✓" : ""}</span></div>
        <div class="bchips">
          ${groupsCards[i].map((c) => html`<${Card} key=${c.id} card=${c} small=${true}
            onClick=${(e) => { if (e && e.stopPropagation) e.stopPropagation(); removeCard(c.id); }} />`)}
          ${assign[i].length === 0 && html`<span class="bempty">tap cards to add</span>`}
        </div>
      </div>`)}
    </div>
    <div class="hand">
      ${hand.map((c) => html`<${Card} key=${c.id} card=${c} sel=${usedAll.has(c.id)} onClick=${() => tapHandCard(c.id)} />`)}
    </div>
    <div class="row between mt">
      <button class="linkbtn" disabled=${!usedAll.size} onClick=${() => { setAssign(groups.map(() => [])); setActive(0); }}>Clear slots</button>
      <span class="tiny muted">${ok ? "Looks valid ✓" : "Fill every slot"}</span>
    </div>
    <button class="btn good block mt" disabled=${!ok}
      onClick=${() => { commit(E.layDown(state, meId, assign)); cancel(); }}>
      ${ok ? `Lay down phase ${phase} ✓` : "Fill the phase to lay down"}
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
function MatchOver({ match, setMatch, players, me, pinfo, client, flash }) {
  const s = match.state;
  const w = pinfo(s.winner);
  const newMatch = async () => {
    const state = E.startMatch(s.players);
    await client.from("matches").update({ status: "finished" }).eq("id", match.id);
    const { data, error } = await client.from("matches").insert({ state, version: 0, status: "playing" }).select().single();
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
