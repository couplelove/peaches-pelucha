import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useMemo, useCallback, useRef } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import * as E from "./engine.js";
import { notifyTurn } from "./push.js";

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
      notifyTurn(client, newState.skipInfo.victim, "Skipped ⊘", `${me.emoji} ${me.name} played a Skip — they go again.`);
    }
  }, [match, client, api, flash, reload, setMatch, me]);

  if (match === undefined) {
    return html`<div class="card center"><div class="muted">Loading game…</div></div>`;
  }
  if (match === null) {
    return html`<${StartMatch} players=${players} client=${client} onStarted=${(row) => { setMatch(row); setImmersive(true); }} flash=${flash} />`;
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
function Card({ card, sel, onClick, small, cid, fan, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }) {
  let face, bg = "#fff", color = "#fff8f3";
  if (E.isNumber(card)) { bg = CARD_BG[card.color]; face = card.num; }
  else if (E.isWild(card)) { bg = "#2b2521"; color = "#e7c98a"; face = "★"; }      // ink card, gold star
  else { bg = "#8c8077"; color = "#fff8f3"; face = "⊘"; }                          // warm grey skip
  const interactive = !!(onClick || onPointerDown);
  const f = fan || {};
  return html`<button data-cid=${cid} data-tf=${f.tf || ""}
    class=${`pcard ${small ? "sm" : ""} ${sel ? "sel" : ""} ${interactive ? "" : "static"}`}
    style=${`background:${bg};color:${color};${f.css || ""}`} onClick=${onClick} disabled=${!interactive}
    onPointerDown=${onPointerDown} onPointerMove=${onPointerMove} onPointerUp=${onPointerUp} onPointerCancel=${onPointerCancel}>${face}</button>`;
}

// Fan layout: one overlapping arched row, like cards held in a hand.
function fanOf(i, n, sel) {
  if (n <= 1) return { tf: "", css: "" };
  const c = i - (n - 1) / 2;
  const rot = c * Math.min(4.5, 34 / n);
  const arc = c * c * (n > 8 ? 0.55 : 1.1);
  const lift = sel ? -16 : 0;
  const overlap = n <= 7 ? -8 : n <= 9 ? -14 : n <= 11 ? -19 : -23;
  const tf = `rotate(${rot.toFixed(2)}deg) translateY(${(arc + lift).toFixed(1)}px)`;
  return { tf, css: `margin-left:${i === 0 ? 0 : overlap}px; z-index:${sel ? 99 : i + 1}; transform:${tf};` };
}

// Draggable fanned hand. Tap a card to select it; drag to rearrange; drag onto
// a glowing pile to play it there. Order is the player's own (never re-sorted).
function Hand({ cards, interactive, selectedId, onSelect, onReorder, canDropOnMeld, onDropOnMeld, canDropOnDiscard, onDropOnDiscard }) {
  const drag = useRef(null);
  const reset = (d) => {
    if (d && d.el) { d.el.classList.remove("dragging"); d.el.style.pointerEvents = ""; d.el.style.transform = d.el.dataset.tf || ""; }
    if (d && d.hoverEl) d.hoverEl.classList.remove("hit", "droptgt");
    drag.current = null;
  };
  const down = (e, id) => {
    drag.current = { id, x: e.clientX, y: e.clientY, el: e.currentTarget, moved: false, reordered: false, hoverEl: null };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) {
      d.moved = true;
      d.el.classList.add("dragging");
      d.el.style.pointerEvents = "none";        // so elementFromPoint sees what's underneath
    }
    if (!d.moved) return;
    // the card follows the finger (composed on top of its fan transform)
    d.el.style.transform = `translate(${e.clientX - d.x}px, ${e.clientY - d.y}px) ${d.el.dataset.tf || ""}`;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    // over a meld or the discard pile? highlight it if this card can go there
    const dropEl = under && under.closest ? (under.closest("[data-meld]") || under.closest("[data-discard]")) : null;
    if (dropEl) {
      const isDiscard = dropEl.hasAttribute("data-discard");
      const ok = isDiscard
        ? !!(canDropOnDiscard && canDropOnDiscard(d.id))
        : !!(canDropOnMeld && canDropOnMeld(d.id, dropEl.getAttribute("data-owner"), +dropEl.getAttribute("data-idx")));
      if (d.hoverEl && d.hoverEl !== dropEl) d.hoverEl.classList.remove("hit", "droptgt");
      d.hoverEl = ok ? dropEl : null;
      if (ok) dropEl.classList.add(isDiscard ? "droptgt" : "hit");
      return;
    }
    if (d.hoverEl) { d.hoverEl.classList.remove("hit", "droptgt"); d.hoverEl = null; }
    // over another hand card? live-reorder
    const t = under && under.closest ? under.closest("[data-cid]") : null;
    const tid = t && t.getAttribute("data-cid");
    if (tid && tid !== d.id) {
      const ids = cards.map((c) => c.id);
      const from = ids.indexOf(d.id), to = ids.indexOf(tid);
      if (from >= 0 && to >= 0) { const n = [...ids]; n.splice(from, 1); n.splice(to, 0, d.id); d.reordered = true; onReorder(n); }
    }
  };
  const up = () => {
    const d = drag.current;
    if (!d) return;
    if (d.hoverEl) {                              // released over a valid target → play it
      const isDiscard = d.hoverEl.hasAttribute("data-discard");
      const owner = d.hoverEl.getAttribute("data-owner"), idx = +d.hoverEl.getAttribute("data-idx");
      reset(d);
      if (isDiscard) onDropOnDiscard && onDropOnDiscard(d.id);
      else onDropOnMeld && onDropOnMeld(d.id, owner, idx);
      return;
    }
    const wasTap = !d.reordered;
    const id = d.id;
    reset(d);
    if (wasTap && interactive) onSelect(id);      // simple tap → select
  };
  return html`<div class="hand">
    ${cards.map((c, i) => html`<${Card} key=${c.id} card=${c} cid=${c.id} sel=${selectedId === c.id}
      fan=${fanOf(i, cards.length, selectedId === c.id)}
      onPointerDown=${(e) => down(e, c.id)} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} />`)}
  </div>`;
}

function Meld({ meld, hittable, onHit, owner, idx }) {
  return html`<div class=${`meld ${hittable ? "hit" : ""}`} onClick=${hittable ? onHit : null}
    data-meld="1" data-owner=${owner} data-idx=${idx}>
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

  const [mode, setMode] = useState("normal"); // normal | laying
  const [pick, setPick] = useState(null);      // selected hand card id (discard/hit)
  useEffect(() => { setMode("normal"); setPick(null); }, [s.turn, s.turnPhase, s.status, s.handNumber]);

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
  const doHit = (ownerId, idx) => { if (pick) { commit(E.hit(s, meId, pick, ownerId, idx)); setPick(null); } };

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

  // With a card selected, every pile it can legally join glows — tap to place.
  const pickedCard = pick ? myHand.find((c) => c.id === pick) : null;
  const tapHittable = (m) => !!pickedCard && myTurn && s.turnPhase === "play" && s.laidDown[meId] && E.canHit(m, pickedCard);

  const topDiscard = s.discard[s.discard.length - 1];
  const discardIsSkip = topDiscard && E.isSkip(topDiscard);
  const goingOut = myHand.length === 1;
  const discardLabel = pickedCard
    ? (E.isSkip(pickedCard) ? "Play Skip ⊘" : goingOut ? "Go out 🎉" : "Discard")
    : null;

  return html`
    <div class="board">
      <!-- opponent zone -->
      <div class="zone opp">
        <div class="pname">
          <span class="nm">${opp_.emoji} ${opp_.name}</span>
          ${s.turn === oppId && s.status === "playing" && html`<span class="gobadge">GO</span>`}
          ${s.skipInfo?.victim === oppId && html`<span class="gobadge skipd">⊘ SKIPPED</span>`}
        </div>
        <div class="microstat">P${s.phaseOf[oppId]} · ${s.scores[oppId]} · ${(s.hands[oppId] || []).length} cards</div>
        ${(s.table[oppId] || []).length > 0 && html`<div class="melds">
          ${s.table[oppId].map((m, i) => html`<${Meld} key=${i} meld=${m} owner=${oppId} idx=${i}
            hittable=${tapHittable(m)} onHit=${() => doHit(oppId, i)} />`)}
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
        ${(s.table[meId] || []).length > 0 && html`<div class="melds">
          ${s.table[meId].map((m, i) => html`<${Meld} key=${i} meld=${m} owner=${meId} idx=${i}
            hittable=${tapHittable(m)} onHit=${() => doHit(meId, i)} />`)}
        </div>`}

        ${mode === "laying"
          ? html`<${LayDown} state=${s} meId=${meId} hand=${myHand} commit=${commit} cancel=${() => setMode("normal")} />`
          : html`
          ${myTurn && s.turnPhase === "play" && html`
            ${pickedCard
              ? html`<button class="bigpill act" onClick=${doDiscard}>${discardLabel}</button>`
              : !s.laidDown[meId]
                ? html`<button class="bigpill" onClick=${() => setMode("laying")}>Phase ${s.phaseOf[meId]} · ${E.phaseText(s.phaseOf[meId])}</button>`
                : null}
          `}
          <${Hand} cards=${myHand} interactive=${myTurn && s.turnPhase === "play"}
            selectedId=${pick} onSelect=${(id) => setPick(pick === id ? null : id)} onReorder=${setOrderSaved}
            canDropOnMeld=${canDropOnMeld} onDropOnMeld=${onDropOnMeld}
            canDropOnDiscard=${canDropOnDiscard} onDropOnDiscard=${onDropOnDiscard} />
          <div class="pname me">
            <button class="linkbtn micro" onClick=${() => setOrderSaved(E.shuffle(handCards).map((c) => c.id))}>🔀</button>
            <span class="nm">${me_.emoji} ${me_.name}</span>
            ${myTurn && html`<span class="gobadge">GO</span>`}
            ${s.skipInfo?.victim === meId && html`<span class="gobadge skipd">⊘ SKIPPED</span>`}
            <button class="linkbtn micro" onClick=${() => setOrderSaved(E.sortHand(handCards).map((c) => c.id))}>⇅</button>
          </div>
          <div class="microstat">P${s.phaseOf[meId]} · ${s.scores[meId]}${s.laidDown[meId] ? " · down ✓" : ""}</div>
        `}
      </div>
    </div>`;
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
    <div class="hand">
      ${hand.map((c, i) => html`<${Card} key=${c.id} card=${c} sel=${usedAll.has(c.id)}
        fan=${fanOf(i, hand.length, usedAll.has(c.id))} onClick=${() => tapHandCard(c.id)} />`)}
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
