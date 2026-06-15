import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useMemo, useRef } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

/* ♠ Casino Hold'em — you vs the dealer, the casino way. Built to TEACH poker:
   real 5-card hand rankings, community cards, one fold/call decision, a dealer
   qualifier, and a live "what you have" read-out. Stakes are practice chips
   (localStorage), never the 💗 hearts economy. Pure local game — no server. */

/* ----------------------------------------------------------- cards -------- */
// rank: 2..14 (11=J,12=Q,13=K,14=A) · suit: 0♠ 1♥ 2♦ 3♣
const SUITS = ["♠", "♥", "♦", "♣"];
const isRed = (s) => s === 1 || s === 2;
const RANKW = { 14: "Ace", 13: "King", 12: "Queen", 11: "Jack", 10: "Ten", 9: "Nine", 8: "Eight", 7: "Seven", 6: "Six", 5: "Five", 4: "Four", 3: "Three", 2: "Two" };
const RANKF = { 14: "A", 13: "K", 12: "Q", 11: "J", 10: "10", 9: "9", 8: "8", 7: "7", 6: "6", 5: "5", 4: "4", 3: "3", 2: "2" };
const plural = (r) => r === 6 ? "Sixes" : RANKW[r] + "s";

function freshDeck() {
  const d = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

/* ------------------------------------------------- hand evaluation -------- */
// score a 5-card hand → comparable array [category, ...tiebreakers].
// 8 straight-flush · 7 quads · 6 full house · 5 flush · 4 straight · 3 trips
// 2 two-pair · 1 pair · 0 high card
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
  const ranks = groups.map((g) => g[1]);                           // ranks by (count desc, rank desc)
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

// the 21 ways to pick 5 of 7
const C75 = (() => { const out = []; for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) for (let c = b + 1; c < 7; c++) for (let d = c + 1; d < 7; d++) for (let e = d + 1; e < 7; e++) out.push([a, b, c, d, e]); return out; })();

function evaluate(cards) {                                          // best of up to 7
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
  const [cat] = sc;
  switch (cat) {
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

// extra ante multiplier paid on straight-or-better when you don't lose
function anteBonus(sc) {
  switch (sc[0]) {
    case 8: return sc[1] === 14 ? 50 : 20;
    case 7: return 10;
    case 6: return 3;
    case 5: return 2;
    case 4: return 1;
    default: return 0;
  }
}

const QUALIFY = [1, 4];     // dealer needs a pair of fours or better
function settle(ante, call, ps, ds) {
  const qualifies = cmp(ds, QUALIFY) >= 0;
  const c = cmp(ps, ds);
  const bonus = anteBonus(ps);
  const lines = [];
  let ret = 0, outcome;
  if (!qualifies) {
    ret = ante * 2 + ante * bonus + call;             // ante pays even money (+bonus), call pushes
    outcome = "win";
    lines.push("Dealer didn't qualify — ante pays, call returned.");
    if (bonus) lines.push(`Ante bonus ×${bonus}.`);
  } else if (c > 0) {
    ret = ante * 2 + ante * bonus + call * 2;          // both bets win even money
    outcome = "win";
    lines.push("You beat the dealer!");
    if (bonus) lines.push(`Ante bonus ×${bonus} for the premium hand.`);
  } else if (c === 0) {
    ret = ante + call; outcome = "push";
    lines.push("Tie — your bets are returned.");
  } else {
    ret = 0; outcome = "lose";
    lines.push("Dealer takes it.");
  }
  return { ret, outcome, qualifies, lines };
}

/* --------------------------------------------------------- card view ------ */
function PCard({ card, back, sm, dealDelay }) {
  if (back || !card) {
    return html`<div class=${`pkcard back ${sm ? "sm" : ""}`} style=${dealDelay != null ? `animation-delay:${dealDelay}ms` : ""}><span class="pk-mono">♠♥<br/>♦♣</span></div>`;
  }
  const red = isRed(card.s);
  return html`<div class=${`pkcard ${red ? "red" : ""} ${sm ? "sm" : ""}`} style=${dealDelay != null ? `animation-delay:${dealDelay}ms` : ""}>
    <span class="pk-corner tl">${RANKF[card.r]}<br/>${SUITS[card.s]}</span>
    <span class="pk-pip">${SUITS[card.s]}</span>
    <span class="pk-corner br">${RANKF[card.r]}<br/>${SUITS[card.s]}</span>
  </div>`;
}

/* ---------------------------------------------------- hand-rank key ------- */
const KEY_ROWS = [
  ["Royal Flush", [[14, 0], [13, 0], [12, 0], [11, 0], [10, 0]], "The top hand — A-K-Q-J-10, all one suit."],
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
      <p class="tiny muted" style="margin-top:-6px">You make the best <b>5-card hand</b> from your 2 cards + the 5 in the middle.</p>
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
const CHIPS_KEY = "pp.poker.v1";
const START_CHIPS = 1000;
const ANTES = [10, 25, 50, 100];

function load() {
  try { const s = JSON.parse(localStorage.getItem(CHIPS_KEY)); if (s && typeof s.chips === "number") return s; } catch {}
  return { chips: START_CHIPS, ante: 25 };
}

export function PokerTab({ me, flash }) {
  const [st, setSt] = useState(load);                 // persisted: {chips, ante, phase, hands...}
  const [showKey, setShowKey] = useState(false);
  const save = (next) => { setSt(next); try { localStorage.setItem(CHIPS_KEY, JSON.stringify(next)); } catch {} };

  const phase = st.phase || "bet";                    // bet | decide | showdown
  const ante = st.ante || 25;
  const chips = st.chips;

  const deal = () => {
    if (chips < ante) { flash("Not enough chips — rebuy first"); return; }
    const d = freshDeck();
    const player = [d.pop(), d.pop()];
    const dealer = [d.pop(), d.pop()];
    const board = [d.pop(), d.pop(), d.pop(), d.pop(), d.pop()];
    // handStart = chips BEFORE the ante, so the result's net is the whole-hand P&L
    save({ ...st, chips: chips - ante, handStart: chips, phase: "decide", deck: [], player, dealer, board, revealed: 3, result: null });
  };

  const fold = () => {
    save({ ...st, phase: "showdown", revealed: 3, result: { outcome: "fold", lines: ["You folded — ante forfeited."], net: chips - st.handStart, showDealer: false } });
  };

  const call = () => {
    if (chips < ante * 2) { flash("Not enough chips to call"); return; }
    const ps = evaluate([...st.player, ...st.board]);
    const ds = evaluate([...st.dealer, ...st.board]);
    const s = settle(ante, ante * 2, ps.score, ds.score);
    const chipsAfter = chips - ante * 2 + s.ret;
    const net = chipsAfter - st.handStart;
    save({
      ...st, chips: chipsAfter, phase: "showdown", revealed: 5,
      result: { outcome: s.outcome, lines: s.lines, net, qualifies: s.qualifies, showDealer: true,
                playerName: ps.name, dealerName: ds.name, bestPlayer: ps.cards, bestDealer: ds.cards },
    });
  };

  const next = () => save({ ...st, phase: "bet", player: null, dealer: null, board: null, result: null });
  const setAnte = (a) => save({ ...st, ante: a });
  const rebuy = () => { save({ ...st, chips: chips + START_CHIPS }); flash(`+${START_CHIPS} practice chips 🪙`); };

  // live "what you have" while deciding (your 2 + the cards shown so far)
  const liveHand = useMemo(() => {
    if (phase === "bet" || !st.player) return null;
    const shown = (st.board || []).slice(0, st.revealed);
    return evaluate([...st.player, ...shown]);
  }, [phase, st.player, st.board, st.revealed]);

  const r = st.result;
  const outClass = r ? (r.outcome === "win" ? "win" : r.outcome === "push" ? "push" : "lose") : "";

  return html`<div class="card pk-table">
    <div class="shead">
      <h2>Poker <span class="muted-glyph">♠</span></h2>
      <div class="shead-actions">
        <button class="linkbtn micro" onClick=${() => setShowKey(true)}>📖 Hands</button>
        <span class="pk-chips">🪙 ${chips}</span>
      </div>
    </div>
    <div class="tiny muted" style="margin:-4px 0 12px">Casino Hold'em · you vs the dealer · practice chips</div>

    <!-- dealer -->
    <div class="pk-zone">
      <div class="pk-zlabel">Dealer ${r && r.showDealer ? html`· <span class="pk-hname">${r.dealerName}${r.qualifies === false ? " (didn't qualify)" : ""}</span>` : ""}</div>
      <div class="pk-row">
        ${phase === "bet"
          ? [0, 1].map(() => html`<${PCard} back=${true} />`)
          : st.dealer.map((c, i) => html`<${PCard} card=${c} back=${!(r && r.showDealer)} dealDelay=${i * 70} />`)}
      </div>
    </div>

    <!-- community -->
    <div class="pk-zone center">
      <div class="pk-zlabel">Community</div>
      <div class="pk-row">
        ${phase === "bet"
          ? [0, 1, 2, 3, 4].map(() => html`<div class="pkcard slot"></div>`)
          : st.board.map((c, i) => i < st.revealed
              ? html`<${PCard} card=${c} dealDelay=${i * 70} />`
              : html`<${PCard} back=${true} />`)}
      </div>
    </div>

    <!-- you -->
    <div class="pk-zone">
      <div class="pk-zlabel">${me ? `${me.emoji} ${me.name}` : "You"} ${liveHand && liveHand.score[0] >= 0 ? html`· <span class="pk-hname you">${phase === "showdown" && r && r.playerName ? r.playerName : liveHand.name}</span>` : ""}</div>
      <div class="pk-row">
        ${phase === "bet"
          ? [0, 1].map(() => html`<div class="pkcard slot"></div>`)
          : st.player.map((c, i) => html`<${PCard} card=${c} dealDelay=${i * 70} />`)}
      </div>
    </div>

    <!-- controls -->
    ${phase === "bet" && html`<div class="pk-controls">
      <div class="pk-antes">
        <span class="tiny muted">Ante</span>
        ${ANTES.map((a) => html`<button class=${`pk-chipbtn ${ante === a ? "on" : ""}`} disabled=${a > chips} onClick=${() => setAnte(a)}>${a}</button>`)}
      </div>
      ${chips < ANTES[0]
        ? html`<button class="btn block" onClick=${rebuy}>Rebuy +${START_CHIPS} 🪙</button>`
        : html`<button class="btn block pk-deal" onClick=${deal}>Deal · ante ${ante} 🪙</button>`}
    </div>`}

    ${phase === "decide" && html`<div class="pk-controls">
      <div class="tiny muted center" style="margin-bottom:8px">Call costs <b>${ante * 2}</b> (2× ante). Fold to give up your ante.</div>
      <div class="pk-decide">
        <button class="btn ghost" onClick=${fold}>Fold</button>
        <button class="btn pk-call" disabled=${chips < ante * 2} onClick=${call}>Call ${ante * 2} 🪙</button>
      </div>
    </div>`}

    ${phase === "showdown" && r && html`<div class=${`pk-result ${outClass}`}>
      <div class="pk-outcome">${r.outcome === "win" ? "You win! 🎉" : r.outcome === "push" ? "Push 🤝" : r.outcome === "fold" ? "Folded" : "Dealer wins"}</div>
      ${r.lines.map((l) => html`<div class="tiny">${l}</div>`)}
      <div class=${`pk-net ${r.net >= 0 ? "pos" : "neg"}`}>${r.net >= 0 ? "+" : ""}${r.net} 🪙</div>
      <button class="btn block mt" onClick=${next}>Next hand 🎴</button>
    </div>`}

    ${showKey && html`<${HandKey} onClose=${() => setShowKey(false)} />`}
  </div>`;
}
