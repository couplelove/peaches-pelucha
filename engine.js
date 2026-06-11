// ============================================================================
//  Phase 10 rules engine — pure functions, no framework, no I/O.
//  The whole game state is a plain JSON object so it can live in one Supabase
//  row and sync to both phones. Actions take a state + args and return a NEW
//  state (never mutate in place), so they're easy to test and to persist.
// ============================================================================

export const COLORS = ["red", "blue", "green", "yellow"];

// The ten phases, as the groups each requires.
//  type: 'set' (same number) | 'run' (consecutive) | 'color' (same colour)
export const PHASES = [
  { groups: [{ type: "set", count: 3 }, { type: "set", count: 3 }], text: "2 sets of 3" },
  { groups: [{ type: "set", count: 3 }, { type: "run", count: 4 }], text: "1 set of 3 + 1 run of 4" },
  { groups: [{ type: "set", count: 4 }, { type: "run", count: 4 }], text: "1 set of 4 + 1 run of 4" },
  { groups: [{ type: "run", count: 7 }], text: "1 run of 7" },
  { groups: [{ type: "run", count: 8 }], text: "1 run of 8" },
  { groups: [{ type: "run", count: 9 }], text: "1 run of 9" },
  { groups: [{ type: "set", count: 4 }, { type: "set", count: 4 }], text: "2 sets of 4" },
  { groups: [{ type: "color", count: 7 }], text: "7 cards of one colour" },
  { groups: [{ type: "set", count: 5 }, { type: "set", count: 2 }], text: "1 set of 5 + 1 set of 2" },
  { groups: [{ type: "set", count: 5 }, { type: "set", count: 3 }], text: "1 set of 5 + 1 set of 3" },
];

export const phaseText = (n) => PHASES[n - 1]?.text || "—";
export const phaseGroups = (n) => PHASES[n - 1]?.groups || [];

/* ----------------------------------------------------------------- cards -- */
// card = { id, kind:'number'|'wild'|'skip', color, num }

let _seq = 0;
function mk(kind, color, num) {
  _seq += 1;
  const tag = kind === "number" ? `${color[0]}${num}` : kind === "wild" ? "w" : "s";
  return { id: `${tag}-${_seq}`, kind, color: color || null, num: num ?? null };
}

export function makeDeck() {
  const d = [];
  for (const c of COLORS) for (let n = 1; n <= 12; n++) { d.push(mk("number", c, n)); d.push(mk("number", c, n)); }
  for (let i = 0; i < 8; i++) d.push(mk("wild"));
  for (let i = 0; i < 4; i++) d.push(mk("skip"));
  return d; // 96 numbers + 8 wild + 4 skip = 108
}

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const isWild = (c) => c.kind === "wild";
export const isSkip = (c) => c.kind === "skip";
export const isNumber = (c) => c.kind === "number";

export function cardPoints(c) {
  if (isSkip(c)) return 15;
  if (isWild(c)) return 25;
  return c.num <= 9 ? 5 : 10;
}
export const scoreHand = (hand) => hand.reduce((s, c) => s + cardPoints(c), 0);

// Sort for a tidy hand display: by colour, then number; wild then skip last.
export function sortHand(hand) {
  const rank = (c) => (isNumber(c) ? COLORS.indexOf(c.color) * 100 + c.num : isWild(c) ? 9000 : 9100);
  return hand.slice().sort((a, b) => rank(a) - rank(b));
}

/* ------------------------------------------------------------ validation -- */
// Each returns true if `cards` legally forms the given group of size `count`.

export function validSet(cards, count) {
  if (cards.length !== count) return false;
  if (cards.some(isSkip)) return false;
  const nat = cards.filter(isNumber);
  if (nat.length === 0) return false;               // can't be all wild
  return nat.every((c) => c.num === nat[0].num);    // all same number
}

export function validColor(cards, count) {
  if (cards.length !== count) return false;
  if (cards.some(isSkip)) return false;
  const nat = cards.filter(isNumber);
  if (nat.length === 0) return false;
  return nat.every((c) => c.color === nat[0].color);
}

export function validRun(cards, count) {
  if (cards.length !== count) return false;
  if (cards.some(isSkip)) return false;
  const nums = cards.filter(isNumber).map((c) => c.num);
  if (nums.length === 0) return false;              // can't be all wild
  const uniq = new Set(nums);
  if (uniq.size !== nums.length) return false;      // no duplicate numbers in a run
  const span = Math.max(...nums) - Math.min(...nums);
  if (span > count - 1) return false;               // naturals too spread for the length
  if (Math.min(...nums) < 1 || Math.max(...nums) > 12) return false;
  return true;                                       // remaining slots filled by wilds
}

export function validGroup(spec, cards) {
  if (spec.type === "set") return validSet(cards, spec.count);
  if (spec.type === "color") return validColor(cards, spec.count);
  if (spec.type === "run") return validRun(cards, spec.count);
  return false;
}

// groupsCards: array parallel to the phase's groups, each an array of cards.
export function validPhase(phaseNum, groupsCards) {
  const gs = phaseGroups(phaseNum);
  if (!gs.length || groupsCards.length !== gs.length) return false;
  return gs.every((spec, i) => validGroup(spec, groupsCards[i] || []));
}

// Can `card` be added to an already-laid meld and keep it legal?
export function canHit(meld, card) {
  if (isSkip(card)) return false;
  return validGroup({ type: meld.type, count: meld.cards.length + 1 }, [...meld.cards, card]);
}

/* --------------------------------------------------------------- actions -- */
// All actions return a fresh state. `state` shape is documented in startMatch.

const clone = (s) => JSON.parse(JSON.stringify(s));
const other = (state, pid) => state.players.find((p) => p !== pid);

export function startMatch(playerIds, rnd = Math.random) {
  const base = {
    players: playerIds.slice(0, 2),
    handNumber: 0,
    dealer: 0,
    phaseOf: {},
    scores: {},
    status: "playing",
    winner: null,
    log: [],
  };
  base.players.forEach((p) => { base.phaseOf[p] = 1; base.scores[p] = 0; });
  return startHand(base, rnd);
}

export function startHand(prev, rnd = Math.random) {
  const s = clone(prev);
  s.handNumber += 1;
  s.dealer = s.handNumber === 1 ? 0 : (s.dealer + 1) % s.players.length;

  let deck = shuffle(makeDeck(), rnd);
  s.hands = {}; s.table = {}; s.laidDown = {}; s.skipped = {};
  s.players.forEach((p) => { s.hands[p] = []; s.table[p] = []; s.laidDown[p] = false; });
  for (let i = 0; i < 10; i++) for (const p of s.players) s.hands[p].push(deck.pop());

  // Flip the first discard; if it's a Skip, bury it and flip again (keeps start simple).
  let top = deck.pop();
  while (isSkip(top)) { deck.unshift(top); top = deck.pop(); }
  s.discard = [top];
  s.draw = deck;

  s.turn = s.players[(s.dealer + 1) % s.players.length];
  s.turnPhase = "draw";       // 'draw' then 'play'
  s.status = "playing";
  s.lastHand = null;
  s.log = [`Hand ${s.handNumber} dealt.`];
  return s;
}

export function drawFrom(state, pid, source) {
  if (state.turn !== pid || state.turnPhase !== "draw") return state;
  const s = clone(state);
  if (source === "discard") {
    if (!s.discard.length || isSkip(s.discard[s.discard.length - 1])) return state; // can't take a skip
    s.hands[pid].push(s.discard.pop());
    s.log.push(`drew from discard`);
  } else {
    if (!s.draw.length) reshuffleDiscardIntoDraw(s);
    s.hands[pid].push(s.draw.pop());
    s.log.push(`drew from pile`);
  }
  s.turnPhase = "play";
  return s;
}

function reshuffleDiscardIntoDraw(s) {
  // Keep the top discard; shuffle the rest back into the draw pile.
  const top = s.discard.pop();
  s.draw = shuffle(s.discard);
  s.discard = top ? [top] : [];
}

// groupsCardIds: array parallel to the phase's groups, each an array of card ids.
export function layDown(state, pid, groupsCardIds) {
  if (state.turn !== pid || state.turnPhase !== "play" || state.laidDown[pid]) return state;
  const hand = state.hands[pid];
  const byId = Object.fromEntries(hand.map((c) => [c.id, c]));
  const groupsCards = groupsCardIds.map((ids) => ids.map((id) => byId[id]).filter(Boolean));
  // every chosen id must exist in hand and not be reused
  const flat = groupsCardIds.flat();
  if (flat.some((id) => !byId[id]) || new Set(flat).size !== flat.length) return state;
  if (!validPhase(state.phaseOf[pid], groupsCards)) return state;

  const s = clone(state);
  const used = new Set(flat);
  s.hands[pid] = s.hands[pid].filter((c) => !used.has(c.id));
  s.table[pid] = phaseGroups(s.phaseOf[pid]).map((spec, i) => ({
    type: spec.type, cards: groupsCards[i],
  }));
  s.laidDown[pid] = true;
  s.log.push(`laid down phase ${s.phaseOf[pid]}`);
  return s;
}

// Add one card from hand to a laid meld (yours or your partner's).
export function hit(state, pid, cardId, ownerId, meldIndex) {
  if (state.turn !== pid || state.turnPhase !== "play" || !state.laidDown[pid]) return state;
  const card = state.hands[pid].find((c) => c.id === cardId);
  const meld = state.table[ownerId]?.[meldIndex];
  if (!card || !meld || !canHit(meld, card)) return state;
  const s = clone(state);
  s.hands[pid] = s.hands[pid].filter((c) => c.id !== cardId);
  s.table[ownerId][meldIndex].cards.push(card);
  s.log.push(`hit a meld`);
  if (s.hands[pid].length === 0) return endHand(s, pid);   // played last card → go out
  return s;
}

export function discard(state, pid, cardId) {
  if (state.turn !== pid || state.turnPhase !== "play") return state;
  const card = state.hands[pid].find((c) => c.id === cardId);
  if (!card) return state;
  const s = clone(state);
  s.hands[pid] = s.hands[pid].filter((c) => c.id !== cardId);
  s.discard.push(card);

  // Discarding a Skip costs the opponent their next turn.
  if (isSkip(card)) { s.skipped[other(s, pid)] = true; s.log.push(`played a Skip!`); }
  else s.log.push(`discarded`);

  if (s.hands[pid].length === 0) return endHand(s, pid);   // went out
  return endTurn(s, pid);
}

function endTurn(s, pid) {
  const opp = other(s, pid);
  if (s.skipped[opp]) { delete s.skipped[opp]; s.log.push(`${"partner"} is skipped`); s.turn = pid; }
  else s.turn = opp;
  s.turnPhase = "draw";
  return s;
}

function endHand(prev, outPid) {
  const s = clone(prev);
  s.status = "handOver";
  const detail = {};
  for (const p of s.players) {
    const pts = scoreHand(s.hands[p]);
    s.scores[p] += pts;
    detail[p] = {
      points: pts,
      wentOut: p === outPid,
      laid: s.laidDown[p],
      fromPhase: s.phaseOf[p],
      advanced: s.laidDown[p],
    };
    if (s.laidDown[p] && s.phaseOf[p] < 10) s.phaseOf[p] += 1; // advance for next hand
  }
  s.lastHand = { outPid, detail, handNumber: s.handNumber };
  s.log.push(`${"someone"} went out.`);

  // Match ends if anyone completed phase 10 this hand (laid down while on phase 10).
  const finishers = s.players.filter((p) => detail[p].laid && detail[p].fromPhase === 10);
  if (finishers.length) {
    finishers.sort((a, b) => s.scores[a] - s.scores[b]); // lowest score wins ties
    s.status = "matchOver";
    s.winner = finishers[0];
  }
  return s;
}

// Whether `pid` can legally lay down their current phase from their hand right now
// (used to enable the button; the actual assignment is chosen in the UI).
export function summary(state) {
  return state; // placeholder for future helpers
}
