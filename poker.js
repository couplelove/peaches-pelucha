import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useMemo, useRef, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

/* ♠ Casino Hold'em — Peaches & Pelucha sit at ONE table and each play their own
   hand against a shared dealer, just like a casino. The whole table is one
   Supabase row (state jsonb + version) synced to both phones, mirroring the
   Phase 10 match model. Stakes are practice chips (per seat, in the shared
   state), never the 💗 hearts economy. */

/* ----------------------------------------------------------- cards -------- */
const SUITS = ["♠", "♥", "♦", "♣"];
const isRed = (s) => s === 1 || s === 2;
const RANKW = { 14: "Ace", 13: "King", 12: "Queen", 11: "Jack", 10: "Ten", 9: "Nine", 8: "Eight", 7: "Seven", 6: "Six", 5: "Five", 4: "Four", 3: "Three", 2: "Two" };
const RANKF = { 14: "A", 13: "K", 12: "Q", 11: "J", 10: "10", 9: "9", 8: "8", 7: "7", 6: "6", 5: "5", 4: "4", 3: "3", 2: "2" };
const plural = (r) => (r === 6 ? "Sixes" : RANKW[r] + "s");

function freshDeck() {
  const d = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

/* ------------------------------------------------- hand evaluation -------- */
function score5(cards) {
  const rs = cards.map((c) => c.r).sort((a, b) => b - a);
  const flush = cards.every((c) => c.s === cards[0].s);
  const uniq = [...new Set(rs)];
  let straight = 0;
  if (uniq.length === 5) {
    if (rs[0] - rs[4] === 4) straight = rs[0];
    else if (rs[0] === 14 && rs[1] === 5) straight = 5;            // wheel A-2-3-4-5
  }
  const cnt = {}; rs.forEach((r) => (cnt[r] = (cnt[r] || 0) + 1));
  const groups = Object.entries(cnt).map(([r, c]) => [c, +r]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const counts = groups.map((g) => g[0]);
  const ranks = groups.map((g) => g[1]);
  if (straight && flush) return [8, straight];
  if (counts[0] === 4) return [7, ranks[0], ranks[1]];
  if (counts[0] === 3 && counts[1] === 2) return [6, ranks[0], ranks[1]];
  if (flush) return [5, ...rs];
  if (straight) return [4, straight];
  if (counts[0] === 3) return [3, ...ranks];
  if (counts[0] === 2 && counts[1] === 2) return [2, ranks[0], ranks[1], ranks[2]];
  if (counts[0] === 2) return [1, ...ranks];
  return [0, ...rs];
}
const cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };
const C75 = (() => { const out = []; for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) for (let c = b + 1; c < 7; c++) for (let d = c + 1; d < 7; d++) for (let e = d + 1; e < 7; e++) out.push([a, b, c, d, e]); return out; })();
function evaluate(cards) {
  if (cards.length < 5) return { score: [-1], name: "—", cards: [] };
  let best = null, bc = null;
  const idxs = cards.length === 5 ? [[0, 1, 2, 3, 4]] : C75;
  for (const idx of idxs) {
    const hand = idx.map((i) => cards[i]);
    const sc = score5(hand);
    if (!best || cmp(sc, best) > 0) { best = sc; bc = hand; }
  }
  return { score: best, name: handName(best), cards: bc };
}
function handName(sc) {
  switch (sc[0]) {
    case 8: return sc[1] === 14 ? "Royal Flush" : `Straight Flush, ${RANKW[sc[1]]} high`;
    case 7: return `Four of a Kind, ${plural(sc[1])}`;
    case 6: return `Full House, ${plural(sc[1])} over ${plural(sc[2])}`;
    case 5: return `Flush, ${RANKW[sc[1]]} high`;
    case 4: return `Straight, ${RANKW[sc[1]]} high`;
    case 3: return `Three of a Kind, ${plural(sc[1])}`;
    case 2: return `Two Pair, ${plural(sc[1])} & ${plural(sc[2])}`;
    case 1: return `Pair of ${plural(sc[1])}`;
    case 0: return `${RANKW[sc[1]]}-High`;
    default: return "—";
  }
}
function anteBonus(sc) {
  switch (sc[0]) {
    case 8: return sc[1] === 14 ? 50 : 20;
    case 7: return 10; case 6: return 3; case 5: return 2; case 4: return 1; default: return 0;
  }
}
const QUALIFY = [1, 4];     // dealer needs a pair of fours or better
function settle(ante, call, ps, ds) {
  const qualifies = cmp(ds, QUALIFY) >= 0;
  const c = cmp(ps, ds);
  const bonus = anteBonus(ps);
  const lines = []; let ret = 0, outcome;
  if (!qualifies) {
    ret = ante * 2 + ante * bonus + call; outcome = "win";
    lines.push("Dealer didn't qualify — ante pays, call returned.");
    if (bonus) lines.push(`Ante bonus ×${bonus}.`);
  } else if (c > 0) {
    ret = ante * 2 + ante * bonus + call * 2; outcome = "win";
    lines.push("Beat the dealer!");
    if (bonus) lines.push(`Ante bonus ×${bonus}.`);
  } else if (c === 0) {
    ret = ante + call; outcome = "push"; lines.push("Tie — bets returned.");
  } else { ret = 0; outcome = "lose"; lines.push("Dealer wins."); }
  return { ret, outcome, qualifies, lines };
}

/* ----------------------------------------------- shared-table logic ------- */
const START_CHIPS = 1000;
const ANTES = [10, 25, 50, 100];

const newSeat = () => ({ chips: START_CHIPS, ante: 25, ready: false, hole: null, decision: "pending", result: null, handStart: START_CHIPS });
function initState(players) {
  const seats = {};
  for (const p of players) seats[p.id] = newSeat();
  return { status: "betting", handNo: 0, deck: [], board: null, dealer: null, revealed: 0, dealerName: null, seats };
}
// make sure every current player has a seat (handles a player added later)
function ensureSeats(state, players) {
  let changed = false; const seats = { ...state.seats };
  for (const p of players) if (!seats[p.id]) { seats[p.id] = newSeat(); changed = true; }
  return changed ? { ...state, seats } : state;
}

function dealMut(state) {
  if (state.status !== "betting") return null;
  const ready = Object.entries(state.seats).filter(([, s]) => s.ready && s.ante > 0 && s.chips >= s.ante);
  if (!ready.length) return null;
  const d = freshDeck();
  const seats = {};
  for (const [id, s] of Object.entries(state.seats)) {
    if (s.ready && s.ante > 0 && s.chips >= s.ante) {
      seats[id] = { ...s, hole: [d.pop(), d.pop()], decision: "pending", result: null, handStart: s.chips, chips: s.chips - s.ante };
    } else {
      seats[id] = { ...s, hole: null, decision: "out", ready: false, result: null };
    }
  }
  const board = [d.pop(), d.pop(), d.pop(), d.pop(), d.pop()];
  const dealer = [d.pop(), d.pop()];
  return { ...state, status: "decision", board, dealer, revealed: 3, dealerName: null, handNo: (state.handNo || 0) + 1, seats };
}
function decisionMut(state, pid, choice) {
  const s = state.seats[pid];
  if (!s || !s.hole || s.decision !== "pending") return null;
  const seats = { ...state.seats };
  if (choice === "call") {
    if (s.chips < s.ante * 2) return null;
    seats[pid] = { ...s, decision: "call", chips: s.chips - s.ante * 2 };
  } else seats[pid] = { ...s, decision: "fold" };
  return { ...state, seats };
}
function showdownMut(state) {
  if (state.status !== "decision") return null;
  const inhand = Object.entries(state.seats).filter(([, s]) => s.hole);
  if (!inhand.length || !inhand.every(([, s]) => s.decision === "call" || s.decision === "fold")) return null;
  const ds = evaluate([...state.dealer, ...state.board]);
  const seats = { ...state.seats };
  for (const [id, s] of inhand) {
    if (s.decision === "fold") {
      seats[id] = { ...s, result: { outcome: "fold", net: s.chips - s.handStart, lines: ["Folded — ante forfeited."] } };
    } else {
      const ps = evaluate([...s.hole, ...state.board]);
      const set = settle(s.ante, s.ante * 2, ps.score, ds.score);
      const chipsAfter = s.chips + set.ret;
      seats[id] = { ...s, chips: chipsAfter, result: { outcome: set.outcome, net: chipsAfter - s.handStart, lines: set.lines, playerName: ps.name, qualifies: set.qualifies } };
    }
  }
  return { ...state, status: "showdown", revealed: 5, dealerName: ds.name, seats };
}
function nextMut(state) {
  if (state.status !== "showdown") return null;
  const seats = {};
  for (const [id, s] of Object.entries(state.seats)) seats[id] = { ...s, hole: null, decision: "pending", result: null, ready: false };
  return { ...state, status: "betting", board: null, dealer: null, revealed: 0, dealerName: null, seats };
}

/* --------------------------------------------------- sync hook ------------ */
function usePokerTable(client, players) {
  const [row, setRowState] = useState(undefined);   // undefined=loading, {id,state,version}
  const ref = useRef(undefined);
  // keep the ref in lockstep with state SYNCHRONOUSLY — apply() reads it, and a
  // lagging ref would make rapid taps mutate stale state and silently decline.
  const setRow = useCallback((r) => { ref.current = r; setRowState(r); }, []);
  const creating = useRef(false);

  const load = useCallback(async () => {
    const { data } = await client.from("poker_table").select("*").order("updated_at", { ascending: false }).limit(1);
    let r = data && data[0];
    if (!r && !creating.current) {
      creating.current = true;
      const { data: made } = await client.from("poker_table").insert({ state: initState(players), version: 0 }).select().single();
      r = made; creating.current = false;
    }
    if (r) { const fixed = ensureSeats(r.state, players); r = { ...r, state: fixed }; }
    setRow(r || null);
  }, [client, players]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let ch = null;
    try {
      ch = client.channel("pp-poker")
        .on("postgres_changes", { event: "*", schema: "public", table: "poker_table" }, (p) => {
          if (p.new && p.new.state) setRow({ id: p.new.id, state: p.new.state, version: p.new.version });
        }).subscribe();
    } catch {}
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    return () => { document.removeEventListener("visibilitychange", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load]);

  // read-modify-write with version guard + retry (two players act concurrently)
  const apply = useCallback(async (mutator) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = ref.current;
      if (!cur) return null;
      const next = mutator(structuredClone(cur.state));
      if (!next) return null;                                  // mutator declined
      const { data, error } = await client.from("poker_table")
        .update({ state: next, version: cur.version + 1, updated_at: new Date().toISOString() })
        .eq("id", cur.id).eq("version", cur.version).select();
      if (!error && data && data.length) { setRow(data[0]); return data[0]; }
      const { data: fresh } = await client.from("poker_table").select("*").order("updated_at", { ascending: false }).limit(1);
      const fr = fresh && fresh[0];
      if (fr) { ref.current = fr; setRow(fr); }
    }
    return null;
  }, [client]);

  return [row, apply];
}

/* --------------------------------------------------------- card view ------ */
function PCard({ card, back, sm, dealDelay }) {
  if (back || !card) return html`<div class=${`pkcard back ${sm ? "sm" : ""}`} style=${dealDelay != null ? `animation-delay:${dealDelay}ms` : ""}><span class="pk-mono">♠♥<br/>♦♣</span></div>`;
  const red = isRed(card.s);
  return html`<div class=${`pkcard ${red ? "red" : ""} ${sm ? "sm" : ""}`} style=${dealDelay != null ? `animation-delay:${dealDelay}ms` : ""}>
    <span class="pk-corner tl">${RANKF[card.r]}<br/>${SUITS[card.s]}</span>
    <span class="pk-pip">${SUITS[card.s]}</span>
    <span class="pk-corner br">${RANKF[card.r]}<br/>${SUITS[card.s]}</span>
  </div>`;
}

/* ---------------------------------------------------- hand-rank key ------- */
const KEY_ROWS = [
  ["Royal Flush", [[14, 0], [13, 0], [12, 0], [11, 0], [10, 0]], "A-K-Q-J-10, all one suit."],
  ["Straight Flush", [[9, 1], [8, 1], [7, 1], [6, 1], [5, 1]], "Five in a row, all one suit."],
  ["Four of a Kind", [[12, 0], [12, 1], [12, 2], [12, 3], [13, 0]], "All four of one rank."],
  ["Full House", [[10, 0], [10, 1], [10, 2], [9, 3], [9, 1]], "Three of a kind + a pair."],
  ["Flush", [[14, 3], [11, 3], [8, 3], [5, 3], [2, 3]], "Five of one suit, any order."],
  ["Straight", [[9, 0], [8, 1], [7, 2], [6, 0], [5, 3]], "Five in a row, mixed suits."],
  ["Three of a Kind", [[7, 0], [7, 1], [7, 2], [13, 3], [2, 0]], "Three of one rank."],
  ["Two Pair", [[11, 0], [11, 1], [4, 2], [4, 3], [14, 0]], "Two different pairs."],
  ["Pair", [[10, 0], [10, 1], [13, 2], [7, 3], [3, 0]], "Two of one rank."],
  ["High Card", [[14, 1], [13, 0], [8, 2], [5, 3], [3, 1]], "Nothing matches — highest card plays."],
];
function HandKey({ onClose }) {
  return html`<div class="modal-bg" onClick=${(e) => { if (e.target.classList.contains("modal-bg")) onClose(); }}>
    <div class="modal pk-key">
      <div class="handle"></div>
      <h3>Poker hands — best to worst ♠</h3>
      <p class="tiny muted" style="margin-top:-6px">Make the best <b>5-card hand</b> from your 2 cards + the 5 in the middle.</p>
      <div class="pk-keylist">
        ${KEY_ROWS.map(([name, cards, note], i) => html`<div class="pk-keyrow" key=${name}>
          <div class="pk-keyrank">${i + 1}</div>
          <div class="pk-keymain">
            <div class="pk-keycards">${cards.map(([r, s]) => html`<${PCard} sm=${true} card=${{ r, s }} />`)}</div>
            <div class="pk-keytext"><b>${name}</b><span class="tiny muted">${note}</span></div>
          </div>
        </div>`)}
      </div>
      <button class="btn block mt" onClick=${onClose}>Got it</button>
    </div>
  </div>`;
}

/* ------------------------------------------------------------ table ------- */
export function PokerTab({ client, me, players, flash }) {
  const [row, apply] = usePokerTable(client, players);
  const [showKey, setShowKey] = useState(false);
  const firing = useRef(false);

  const st = row && row.state;

  // auto-reveal: once everyone in the hand has folded/called, run the showdown.
  // fired by whichever phone notices; the status + version guards make a double
  // fire harmless. `firing` just avoids re-applying while one write is in flight.
  useEffect(() => {
    if (!st || st.status !== "decision") { firing.current = false; return; }
    const inhand = Object.values(st.seats).filter((s) => s.hole);
    const allIn = inhand.length && inhand.every((s) => s.decision !== "pending");
    if (allIn && !firing.current) {
      firing.current = true;
      Promise.resolve(apply(showdownMut)).finally(() => { firing.current = false; });
    }
  }, [st, apply]);

  if (row === undefined) return html`<div class="card pk-table"><div class="empty"><span class="big">♠</span>Dealing you in…</div></div>`;
  if (!st) return html`<div class="card pk-table"><div class="empty"><span class="big">♠</span>Couldn't open the table.</div></div>`;

  const mySeat = st.seats[me.id] || newSeat();
  const others = players.filter((p) => p.id !== me.id);
  const phase = st.status;
  const pinfo = (id) => players.find((p) => p.id === id) || { name: "?", emoji: "❔" };

  // user actions go straight through apply() — its version-guard + retry makes
  // concurrent/duplicate taps safe, and each mutator declines if out of phase,
  // so a tap is never silently swallowed by an in-flight flag.
  const setAnte = (a) => apply((s) => ({ ...s, seats: { ...s.seats, [me.id]: { ...s.seats[me.id], ante: a } } }));
  const toggleReady = () => apply((s) => { const seat = s.seats[me.id]; return { ...s, seats: { ...s.seats, [me.id]: { ...seat, ready: !seat.ready } } }; });
  const deal = () => apply(dealMut);
  const decide = (choice) => {
    if (choice === "call" && mySeat.chips < mySeat.ante * 2) { flash("Not enough chips to call"); return; }
    apply((s) => decisionMut(s, me.id, choice));
  };
  const next = () => apply(nextMut);
  const rebuy = () => apply((s) => ({ ...s, seats: { ...s.seats, [me.id]: { ...s.seats[me.id], chips: s.seats[me.id].chips + START_CHIPS } } }));

  const readyCount = Object.values(st.seats).filter((s) => s.ready && s.ante > 0 && s.chips >= s.ante).length;

  // live "what you have" for my seat during the hand
  const myLive = useMemo(() => {
    if (!mySeat.hole) return null;
    return evaluate([...mySeat.hole, ...(st.board || []).slice(0, st.revealed)]);
  }, [mySeat.hole, st.board, st.revealed]);

  const SeatLine = (p) => {
    const s = st.seats[p.id] || newSeat();
    const meSeat = p.id === me.id;
    const r = s.result;
    const showCards = !!s.hole;     // both players see each other's hole cards at this shared table
    const statusTag =
      phase === "betting" ? (s.ready && s.ante > 0 ? `ready · ${s.ante}` : s.ante === 0 ? "sitting out" : "choosing…")
      : phase === "decision" ? (s.decision === "out" ? "sitting out" : s.decision === "pending" ? "deciding…" : s.decision.toUpperCase())
      : r ? "" : (s.hole ? "" : "sat out");
    return html`<div class=${`pk-seat ${meSeat ? "me" : ""} ${r ? r.outcome : ""}`} key=${p.id}>
      <div class="pk-seathead">
        <span class="pk-seatname">${p.emoji} ${p.name}${meSeat ? " (you)" : ""}</span>
        <span class="pk-seatchips">🪙 ${s.chips}</span>
      </div>
      <div class="pk-seatbody">
        <div class="pk-row sm">
          ${showCards ? s.hole.map((c, i) => html`<${PCard} sm=${true} card=${c} dealDelay=${i * 60} />`)
            : [0, 1].map(() => html`<div class="pkcard sm slot"></div>`)}
        </div>
        <div class="pk-seatinfo">
          ${r && r.playerName ? html`<span class="pk-hname ${r.outcome === "win" ? "win" : ""}">${r.playerName}</span>`
            : (meSeat && myLive && myLive.score[0] >= 0 && phase === "decision") ? html`<span class="pk-hname you">${myLive.name}</span>`
            : html`<span class="pk-tag">${statusTag}</span>`}
          ${r && html`<span class=${`pk-net ${r.net >= 0 ? "pos" : "neg"}`}>${r.net >= 0 ? "+" : ""}${r.net} 🪙</span>`}
        </div>
      </div>
    </div>`;
  };

  return html`<div class="card pk-table">
    <div class="shead">
      <h2>Poker <span class="muted-glyph">♠</span></h2>
      <div class="shead-actions">
        <button class="linkbtn micro" onClick=${() => setShowKey(true)}>📖 Hands</button>
      </div>
    </div>
    <div class="tiny muted" style="margin:-4px 0 14px">Casino Hold'em · you & ${others.map((o) => o.name).join(" & ") || "the table"} vs the dealer</div>

    <!-- dealer + community -->
    <div class="pk-zone center">
      <div class="pk-zlabel">Dealer ${st.dealerName ? html`· <span class="pk-hname">${st.dealerName}</span>` : ""}</div>
      <div class="pk-row">
        ${phase === "betting" ? [0, 1].map(() => html`<div class="pkcard slot"></div>`)
          : st.dealer.map((c, i) => html`<${PCard} card=${c} back=${phase !== "showdown"} dealDelay=${i * 70} />`)}
      </div>
      <div class="pk-zlabel" style="margin-top:12px">Community</div>
      <div class="pk-row">
        ${phase === "betting" ? [0, 1, 2, 3, 4].map(() => html`<div class="pkcard slot"></div>`)
          : st.board.map((c, i) => i < st.revealed ? html`<${PCard} card=${c} dealDelay=${i * 70} />` : html`<${PCard} back=${true} />`)}
      </div>
    </div>

    <!-- seats -->
    <div class="pk-seats">
      ${SeatLine(me)}
      ${others.map((o) => SeatLine(o))}
    </div>

    <!-- controls -->
    ${phase === "betting" && html`<div class="pk-controls">
      <div class="pk-antes">
        <span class="tiny muted">Your ante</span>
        ${ANTES.map((a) => html`<button class=${`pk-chipbtn ${mySeat.ante === a ? "on" : ""}`} disabled=${a > mySeat.chips || mySeat.ready} onClick=${() => setAnte(a)}>${a}</button>`)}
      </div>
      ${mySeat.chips < ANTES[0]
        ? html`<button class="btn block" onClick=${rebuy}>Rebuy +${START_CHIPS} 🪙</button>`
        : html`<div class="pk-decide">
            <button class=${`btn ${mySeat.ready ? "ghost" : "good"}`} onClick=${toggleReady}>${mySeat.ready ? "✓ Ready — tap to undo" : "I'm in"}</button>
            <button class="btn pk-deal" disabled=${readyCount < 1 || !mySeat.ready} onClick=${deal}>Deal · ${readyCount} in</button>
          </div>
          <div class="tiny muted center" style="margin-top:8px">
            ${others.map((o) => { const os = st.seats[o.id] || {}; return os.ready && os.ante > 0 ? `${o.emoji} ready` : `waiting for ${o.emoji} ${o.name}…`; }).join(" · ")}
          </div>`}
    </div>`}

    ${phase === "decision" && html`<div class="pk-controls">
      ${mySeat.hole && mySeat.decision === "pending"
        ? html`<div class="tiny muted center" style="margin-bottom:8px">Call costs <b>${mySeat.ante * 2}</b> (2× ante), or fold your ${mySeat.ante} ante.</div>
            <div class="pk-decide">
              <button class="btn ghost" onClick=${() => decide("fold")}>Fold</button>
              <button class="btn pk-call" disabled=${mySeat.chips < mySeat.ante * 2} onClick=${() => decide("call")}>Call ${mySeat.ante * 2} 🪙</button>
            </div>`
        : html`<div class="tiny muted center">${mySeat.hole ? `You ${mySeat.decision === "call" ? "called" : "folded"} — waiting for the table…` : "You sat this one out."}</div>`}
    </div>`}

    ${phase === "showdown" && html`<div class="pk-controls">
      <button class="btn block" onClick=${next}>Next hand 🎴</button>
    </div>`}

    ${showKey && html`<${HandKey} onClose=${() => setShowKey(false)} />`}
  </div>`;
}
