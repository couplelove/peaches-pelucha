import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useMemo, useRef, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

/* 🎲 Uno — Peaches & Pelucha share ONE deck at the table, mirroring the Phase 10
   / Poker model: the whole game is a single Supabase row (state jsonb + version)
   synced to both phones. No I/O lives in the rules below — they're pure. Built
   for N seats but the app only ever has the two of them. House rule, same as
   Phase 10: legality is never disclosed before commitment — tap an illegal card
   and it shakes back; nothing pre-glows. */

/* ----------------------------------------------------------- cards -------- */
const COLORS = ["r", "y", "g", "b"];
const COLOR_NAME = { r: "Red", y: "Yellow", g: "Green", b: "Blue", w: "Wild" };
const ACTION_LABEL = { skip: "⊘", rev: "⇆", draw2: "+2", wild: "★", wild4: "+4" };
const cardLabel = (card) => (typeof card.v === "number" ? String(card.v) : ACTION_LABEL[card.v]);

function freshDeck() {
  const d = [];
  for (const c of COLORS) {
    d.push({ c, v: 0 });
    for (let n = 1; n <= 9; n++) { d.push({ c, v: n }); d.push({ c, v: n }); }
    for (const a of ["skip", "rev", "draw2"]) { d.push({ c, v: a }); d.push({ c, v: a }); }
  }
  for (let i = 0; i < 4; i++) { d.push({ c: "w", v: "wild" }); d.push({ c: "w", v: "wild4" }); }
  return shuffle(d);
}
function shuffle(d) {
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

/* --------------------------------------------------- table logic ---------- */
function initState(players) {
  return {
    status: "lobby",            // lobby | playing | over
    seatOrder: players.map((p) => p.id),
    hands: {}, draw: [], discard: [],
    current: null, dir: 1, color: null,
    winner: null, drew: null, handNo: 0,
    last: null,                 // {pid, text} — a one-line feed of the last move
  };
}
function ensureSeats(state, players) {
  let changed = false;
  const seatOrder = [...state.seatOrder]; const hands = { ...state.hands };
  for (const p of players) if (!seatOrder.includes(p.id)) {
    seatOrder.push(p.id); if (state.status === "playing") hands[p.id] = [];
    changed = true;
  }
  return changed ? { ...state, seatOrder, hands } : state;
}

// the next seat `steps` along, honouring direction (wraps)
function stepId(state, from, steps) {
  const ids = state.seatOrder, n = ids.length;
  const i = ids.indexOf(from);
  return ids[(((i + steps * state.dir) % n) + n) % n];
}
const topCard = (state) => state.discard[state.discard.length - 1];
function legal(card, color, top) {
  if (card.c === "w") return true;                 // wilds always play
  if (card.c === color) return true;               // colour match
  if (card.v === top.v) return true;               // rank / symbol match
  return false;
}

function reshuffle(state) {
  if (state.draw.length > 0 || state.discard.length <= 1) return state;
  const top = state.discard[state.discard.length - 1];
  return { ...state, draw: shuffle(state.discard.slice(0, -1)), discard: [top] };
}
function drawCards(state, pid, n) {
  let s = { ...state, hands: { ...state.hands }, draw: [...state.draw], discard: [...state.discard] };
  const hand = [...(s.hands[pid] || [])];
  for (let k = 0; k < n; k++) {
    if (s.draw.length === 0) { s = reshuffle(s); s.draw = [...s.draw]; s.discard = [...s.discard]; }
    if (s.draw.length === 0) break;                 // deck exhausted — rare in 2p
    hand.push(s.draw.shift());
  }
  s.hands = { ...s.hands, [pid]: hand };
  return s;
}

function dealMut(state) {
  if (state.status === "playing") return null;
  const ids = state.seatOrder;
  if (ids.length < 2) return null;
  let d = freshDeck();
  const hands = {};
  for (const id of ids) hands[id] = d.splice(0, 7);
  // first up-card: bury non-number cards so the game opens cleanly (no starter effect)
  const buried = []; let first;
  while (true) { first = d.shift(); if (typeof first.v === "number") break; buried.push(first); }
  d.push(...buried);
  return {
    ...state, status: "playing", handNo: (state.handNo || 0) + 1,
    hands, draw: d, discard: [first], color: first.c,
    current: ids[0], dir: 1, winner: null, drew: null,
    last: null,
  };
}

// play hand[idx]; chosenColor required for wilds
function playMut(state, pid, idx, chosenColor) {
  if (state.status !== "playing" || state.current !== pid) return null;
  const hand = state.hands[pid];
  if (!hand || idx < 0 || idx >= hand.length) return null;
  const card = hand[idx];
  if (!legal(card, state.color, topCard(state))) return null;
  if (card.c === "w" && !COLORS.includes(chosenColor)) return null;
  const hands = { ...state.hands, [pid]: hand.filter((_, i) => i !== idx) };
  const discard = [...state.discard, card];
  const color = card.c === "w" ? chosenColor : card.c;
  const lbl = card.c === "w" ? `${cardLabel(card)} → ${COLOR_NAME[color]}` : `${COLOR_NAME[card.c]} ${cardLabel(card)}`;

  if (hands[pid].length === 0)
    return { ...state, hands, discard, color, status: "over", winner: pid, drew: null, last: { pid, text: `played ${lbl} to win!` } };

  let dir = state.dir, skip = 0, drawN = 0;
  if (card.v === "skip") skip = 1;
  else if (card.v === "rev") { dir = -state.dir; if (state.seatOrder.length === 2) skip = 1; }
  else if (card.v === "draw2") { drawN = 2; skip = 1; }
  else if (card.v === "wild4") { drawN = 4; skip = 1; }

  let s = { ...state, hands, discard, color, dir, drew: null, last: { pid, text: `played ${lbl}` } };
  if (drawN) {
    const victim = stepId(s, pid, 1);
    s = drawCards(s, victim, drawN);
    s.current = stepId(s, pid, 2);                  // victim draws, then is skipped
  } else {
    s.current = stepId(s, pid, skip ? 2 : 1);
  }
  return s;
}

// voluntary draw on your turn (couldn't / chose not to play)
function drawMut(state, pid) {
  if (state.status !== "playing" || state.current !== pid || state.drew === pid) return null;
  const s = drawCards(state, pid, 1);
  return { ...s, drew: pid, last: { pid, text: "drew a card" } };
}
// pass after drawing
function passMut(state, pid) {
  if (state.status !== "playing" || state.current !== pid || state.drew !== pid) return null;
  return { ...state, drew: null, current: stepId(state, pid, 1), last: { pid, text: "passed" } };
}

/* --------------------------------------------------- sync hook ------------ */
function useUnoTable(client, players, room = null) {
  const [row, setRowState] = useState(undefined);
  const ref = useRef(undefined);
  const setRow = useCallback((r) => { ref.current = r; setRowState(r); }, []);
  const creating = useRef(false);
  const scoped = useCallback(() => { const q = client.from("uno_table").select("*"); return room ? q.eq("room", room) : q.is("room", null); }, [client, room]);

  const load = useCallback(async () => {
    const { data } = await scoped().order("updated_at", { ascending: false }).limit(1);
    let r = data && data[0];
    if (!r && !creating.current) {
      creating.current = true;
      const { data: made } = await client.from("uno_table").insert({ state: initState(players), version: 0, room }).select().single();
      r = made; creating.current = false;
    }
    if (r) r = { ...r, state: ensureSeats(r.state, players) };
    setRow(r || null);
  }, [scoped, players, room, client]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let ch = null;
    try {
      ch = client.channel("pp-uno-" + (room || "private"))
        .on("postgres_changes", { event: "*", schema: "public", table: "uno_table" }, (p) => {
          if (p.new && p.new.state && (p.new.room ?? null) === (room ?? null)) setRow({ id: p.new.id, state: p.new.state, version: p.new.version });
        }).subscribe();
    } catch {}
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    return () => { document.removeEventListener("visibilitychange", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load, room]);

  const apply = useCallback(async (mutator) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = ref.current;
      if (!cur) return null;
      const next = mutator(structuredClone(cur.state));
      if (!next) return null;
      const { data, error } = await client.from("uno_table")
        .update({ state: next, version: cur.version + 1, updated_at: new Date().toISOString() })
        .eq("id", cur.id).eq("version", cur.version).select();
      if (!error && data && data.length) { setRow(data[0]); return data[0]; }
      const { data: fresh } = await scoped().order("updated_at", { ascending: false }).limit(1);
      const fr = fresh && fresh[0];
      if (fr) { ref.current = fr; setRow(fr); }
    }
    return null;
  }, [client, scoped]);

  return [row, apply];
}

/* --------------------------------------------------------- card view ------ */
function UCard({ card, sm, faceDown, nope, onClick }) {
  if (faceDown || !card)
    return html`<div class=${`ucard back ${sm ? "sm" : ""}`}><span class="uc-logo">UNO</span></div>`;
  const lbl = cardLabel(card);
  const cls = `ucard u-${card.c} ${sm ? "sm" : ""} ${nope ? "nope" : ""}`;
  const inner = html`<${h.Fragment}>
    <span class="uc-corner tl">${lbl}</span>
    <span class="uc-center">${lbl}</span>
    <span class="uc-corner br">${lbl}</span>
  <//>`;
  // hand cards are real controls; static faces (pile/opponent) are inert divs
  return onClick
    ? html`<button class=${cls} onClick=${onClick}>${inner}</button>`
    : html`<div class=${`${cls} static`}>${inner}</div>`;
}

/* ------------------------------------------------------------ table ------- */
export function UnoTab({ client, me, players, flash, room = null }) {
  const [row, apply] = useUnoTable(client, players, room);
  const [immersive, setImmersive] = useState(false);
  const [picking, setPicking] = useState(null);   // {idx} — choosing a colour for a wild
  const [nopeIdx, setNopeIdx] = useState(-1);
  const nopeT = useRef(0);

  const st = row && row.state;
  const pinfo = useCallback((id) => players.find((p) => p.id === id) || { name: "?", emoji: "❔" }, [players]);

  if (row === undefined) return html`<div class="card"><div class="empty"><span class="big">🎲</span>Shuffling the deck…</div></div>`;
  if (!st) return html`<div class="card"><div class="empty"><span class="big">🎲</span>Couldn't open the table.</div></div>`;

  const myTurn = st.status === "playing" && st.current === me.id;
  const myHand = st.hands[me.id] || [];
  const others = players.filter((p) => p.id !== me.id);
  const top = st.discard.length ? st.discard[st.discard.length - 1] : null;
  const drew = st.drew === me.id;

  const deal = () => apply(dealMut);
  const draw = () => apply((s) => drawMut(s, me.id));
  const pass = () => apply((s) => passMut(s, me.id));
  const tapCard = (idx) => {
    const card = myHand[idx];
    if (!myTurn || !legal(card, st.color, top)) { bump(idx); return; }
    if (card.c === "w") { setPicking({ idx }); return; }
    apply((s) => playMut(s, me.id, idx, null));
  };
  const playWild = (color) => { const idx = picking.idx; setPicking(null); apply((s) => playMut(s, me.id, idx, color)); };
  const bump = (idx) => { setNopeIdx(idx); clearTimeout(nopeT.current); nopeT.current = setTimeout(() => setNopeIdx(-1), 420); };

  // ---- compact home card ----
  let cardStatus;
  if (st.status === "lobby") cardStatus = "Tap to deal a hand";
  else if (st.status === "over") cardStatus = st.winner === me.id ? "You won! 🎉" : `${pinfo(st.winner).name} won`;
  else cardStatus = myTurn ? (drew ? "Play the drawn card or pass" : "Your turn") : `${pinfo(st.current).name}'s turn…`;
  if (!immersive) {
    return html`<div class="card gamehero" onClick=${() => setImmersive(true)}>
      <div class="eyebrow">Uno <span class="muted-glyph">🎲</span></div>
      <div class="gamehero-title">${cardStatus}</div>
      <div class="gamehero-meta tnum">${players.map((p) => `${p.emoji} ${(st.hands[p.id] || []).length}🃏`).join("   ·   ")}</div>
      <button class="btn gamehero-btn" onClick=${(e) => { e.stopPropagation(); setImmersive(true); }}>Open game</button>
    </div>`;
  }

  // ---- full-screen game room ----
  return html`<div class="gamefs uno-fs">
    <div class="gamefs-bar">
      <button class="iconbtn" onClick=${() => setImmersive(false)}>‹</button>
      <div class="gamefs-title">Uno 🎲${st.handNo ? ` · Hand ${st.handNo}` : ""}</div>
      <div class=${`uno-dir ${st.dir < 0 ? "rev" : ""}`} title="Play direction">${st.dir < 0 ? "⟲" : "⟳"}</div>
    </div>
    <div class="gamefs-body"><div class="uno-room">

      <!-- opponents -->
      <div class="uno-opps">
        ${others.map((o) => {
          const n = (st.hands[o.id] || []).length;
          const turn = st.current === o.id && st.status === "playing";
          return html`<div class=${`uno-opp ${turn ? "turn" : ""}`} key=${o.id}>
            <div class="uno-oppname">${o.emoji} ${o.name}${turn ? " ·" : ""}</div>
            <div class="uno-oppfan">
              ${Array.from({ length: Math.min(n, 10) }).map((_, i) => html`<${UCard} key=${i} sm=${true} faceDown=${true} />`)}
              ${n > 10 ? html`<span class="uno-more">+${n - 10}</span>` : ""}
            </div>
            <div class=${`uno-count ${n === 1 ? "uno" : ""}`}>${n === 1 ? "UNO!" : `${n} cards`}</div>
          </div>`;
        })}
      </div>

      <!-- pile + discard -->
      <div class="uno-mid">
        <button class="uno-pile" onClick=${myTurn && !drew ? draw : undefined} disabled=${!myTurn || drew}>
          <${UCard} faceDown=${true} />
          <span class="uno-pilelbl">Draw</span>
        </button>
        <div class="uno-discard">
          ${top ? html`<${UCard} card=${top} />` : html`<div class="ucard back"></div>`}
          ${st.color ? html`<span class=${`uno-color u-${st.color}`}>${COLOR_NAME[st.color]}</span>` : ""}
        </div>
      </div>

      ${st.last ? html`<div class="uno-feed">${pinfo(st.last.pid).emoji} ${st.last.text}</div>` : ""}

      <!-- my hand -->
      <div class="uno-handwrap">
        <div class="uno-handhead">
          <span>${me.emoji} You · ${myHand.length}🃏</span>
          ${myTurn ? html`<span class="uno-yourturn">your turn</span>` : ""}
        </div>
        <div class="uno-hand">
          ${myHand.length
            ? myHand.map((c, i) => html`<${UCard} key=${`${i}-${c.c}${c.v}`} card=${c} nope=${nopeIdx === i} onClick=${() => tapCard(i)} />`)
            : html`<div class="tiny muted">No cards.</div>`}
        </div>
      </div>

      <!-- controls -->
      <div class="uno-controls">
        ${st.status === "lobby" && html`<button class="btn block" onClick=${deal} disabled=${st.seatOrder.length < 2}>Deal · ${players.length} players 🎴</button>`}
        ${st.status === "over" && html`<div class="uno-over">
          <div class="uno-winner">${st.winner === me.id ? "🎉 You won!" : `${pinfo(st.winner).emoji} ${pinfo(st.winner).name} won`}</div>
          <button class="btn block" onClick=${deal}>Play again 🎴</button>
        </div>`}
        ${st.status === "playing" && (myTurn
          ? (drew
              ? html`<div class="uno-decide"><span class="tiny muted">Drew a card — play it if you can, or pass.</span><button class="btn ghost block" onClick=${pass}>Pass →</button></div>`
              : html`<div class="tiny muted center">Tap a card to play, or draw from the pile.</div>`)
          : html`<div class="tiny muted center">Waiting for ${pinfo(st.current).name}…</div>`)}
      </div>

    </div></div>

    ${picking && html`<div class="modal-bg gr-modal" onClick=${(e) => { if (e.target.classList.contains("modal-bg")) setPicking(null); }}>
      <div class="modal uno-pick">
        <div class="handle"></div>
        <h3>Pick a colour</h3>
        <div class="uno-swatches">
          ${COLORS.map((c) => html`<button class=${`uno-swatch u-${c}`} key=${c} onClick=${() => playWild(c)}>${COLOR_NAME[c]}</button>`)}
        </div>
      </div>
    </div>`}
  </div>`;
}
