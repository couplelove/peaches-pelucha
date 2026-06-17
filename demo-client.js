// In-memory stand-in for the Supabase client, used only when the app is opened
// with ?demo=1. Lets you (and tests) try every screen with no database — data
// lives in memory and resets on reload. The real app uses Supabase.
let _id = 1;
const uid = () => "demo-" + (_id++);
const nowISO = () => new Date().toISOString();

function seed() {
  const peaches = uid(), pelucha = uid();
  const db = {
    players: [
      { id: peaches, name: "Peaches", emoji: "🍑", color: "#ff7a91", created_at: nowISO() },
      { id: pelucha, name: "Pelucha", emoji: "🧸", color: "#9b6bff", created_at: nowISO() },
    ],
    games: [], game_players: [], rounds: [], round_entries: [],
    transactions: [
      { id: uid(), player_id: peaches, amount: 50, type: "earn", description: "Win a game", created_at: nowISO() },
      { id: uid(), player_id: pelucha, amount: 20, type: "earn", description: "Cooked dinner", created_at: nowISO() },
    ],
    earn_rules: [
      { id: uid(), label: "Win a game", amount: 50, emoji: "🏆", active: true, sort: 1, created_at: nowISO() },
      { id: uid(), label: "First to finish a phase", amount: 10, emoji: "⭐", active: true, sort: 2, created_at: nowISO() },
      { id: uid(), label: "Good morning text", amount: 5, emoji: "☀️", active: true, sort: 3, created_at: nowISO() },
      { id: uid(), label: "Cooked dinner", amount: 20, emoji: "🍝", active: true, sort: 4, created_at: nowISO() },
      { id: uid(), label: "Just because I love you", amount: 15, emoji: "💌", active: true, sort: 5, created_at: nowISO() },
    ],
    rewards: [
      { id: uid(), label: "Breakfast in bed", cost: 100, emoji: "🥞", active: true, sort: 1, created_at: nowISO() },
      { id: uid(), label: "Pick the movie", cost: 40, emoji: "🎬", active: true, sort: 2, created_at: nowISO() },
      { id: uid(), label: "Back massage", cost: 80, emoji: "💆", active: true, sort: 3, created_at: nowISO() },
      { id: uid(), label: "Win one argument, no Qs", cost: 200, emoji: "🤝", active: true, sort: 4, created_at: nowISO() },
    ],
    bets: [],
    matches: [],
    social_links: [],
    watch_state: [],
    trash_talk: [],
    memories: [],
    todos: [],
    push_subscriptions: [],
    date_ideas: [
      { id: uid(), label: "Sushi night", emoji: "🍣", category: "food", active: true, added_by: peaches, created_at: nowISO() },
      { id: uid(), label: "Taco crawl", emoji: "🌮", category: "food", active: true, added_by: pelucha, created_at: nowISO() },
      { id: uid(), label: "Mini golf", emoji: "⛳", category: "activity", active: true, added_by: peaches, created_at: nowISO() },
      { id: uid(), label: "Museum date", emoji: "🖼️", category: "activity", active: true, added_by: pelucha, created_at: nowISO() },
    ],
    date_spins: [],
    events: [
      { id: uid(), title: "Dinner at Nonna's", emoji: "🍝", starts_on: new Date().toISOString().slice(0, 10),
        starts_at: "19:00", notes: null, kind: "invite", created_by: peaches, rsvp: "pending", created_at: nowISO() },
    ],
  };
  // a sample active game with one round so the scoreboard isn't empty
  const g = { id: uid(), name: "Cozy night", status: "active", winner_id: null, created_at: nowISO(), finished_at: null };
  db.games.push(g);
  db.game_players.push(
    { id: uid(), game_id: g.id, player_id: peaches, seat: 0 },
    { id: uid(), game_id: g.id, player_id: pelucha, seat: 1 });
  const r1 = { id: uid(), game_id: g.id, round_number: 1, created_at: nowISO() };
  db.rounds.push(r1);
  db.round_entries.push(
    { id: uid(), round_id: r1.id, player_id: peaches, points: 15, completed_phase: true },
    { id: uid(), round_id: r1.id, player_id: pelucha, points: 35, completed_phase: false });
  return db;
}

// Column defaults that Postgres would apply on insert (mirrors schema.sql).
const DEFAULTS = {
  players: { emoji: "🍑", color: "#ff7a91" },
  games: { status: "active", winner_id: null, finished_at: null },
  game_players: { seat: 0 },
  rounds: {},
  round_entries: { points: 0, completed_phase: false },
  transactions: { type: "adjust", description: null },
  earn_rules: { amount: 10, emoji: "✨", active: true, sort: 0 },
  rewards: { cost: 50, emoji: "🎁", active: true, sort: 0 },
  bets: { stake: 10, status: "open", winner_id: null, settled_at: null },
  matches: { status: "playing", version: 0 },
  trash_talk: { player_id: null },
  memories: { kind: "photo", uploaded_by: null, place: null, lat: null, lng: null, thumb_path: null, blur: null },
  social_links: { platform: "other", video_id: null, mode: "share", sender_id: null, recipient_id: null, note: null, seen_at: null, reactions: [], status: "active" },
  todos: { due_on: null, done: false, done_at: null, created_by: null },
  date_ideas: { emoji: "✨", category: "food", active: true, added_by: null },
  date_spins: { emoji: "✨", category: "food", spun_by: null },
  events: { emoji: "💗", starts_at: null, notes: null, location: null, kind: "invite", created_by: null, rsvp: "pending" },
};

function matches(row, filters) {
  return filters.every((f) => f.op === "gte" ? row[f.col] >= f.val : f.op === "lt" ? row[f.col] < f.val : f.op === "in" ? f.vals.includes(row[f.col]) : f.op === "is" ? (f.val === null ? row[f.col] == null : row[f.col] === f.val) : row[f.col] === f.val);
}

// Minimal thenable query builder mirroring the bits of supabase-js the app uses.
function query(db, table) {
  const state = { selectStr: "*", filters: [], orders: [], limitN: null, single: false, op: "select", payload: null };
  const builder = {
    select(str) { state.selectStr = str || "*"; if (state.op !== "select") state._returnRows = true; return builder; },
    eq(col, val) { state.filters.push({ col, val }); return builder; },
    gte(col, val) { state.filters.push({ col, val, op: "gte" }); return builder; },
    lt(col, val) { state.filters.push({ col, val, op: "lt" }); return builder; },
    in(col, vals) { state.filters.push({ col, vals, op: "in" }); return builder; },
    is(col, val) { state.filters.push({ col, val, op: "is" }); return builder; },
    order(col, opts) { state.orders.push({ col, asc: !opts || opts.ascending !== false }); return builder; },
    limit(n) { state.limitN = n; return builder; },
    range(from, to) { state.rangeFrom = from; state.rangeTo = to; return builder; },
    single() { state.single = true; return builder; },
    insert(payload) { state.op = "insert"; state.payload = payload; return builder; },
    update(payload) { state.op = "update"; state.payload = payload; return builder; },
    delete() { state.op = "delete"; return builder; },
    then(resolve) { resolve(run(db, table, state)); },
  };
  return builder;
}

function run(db, table, s) {
  try {
    const rows = db[table];
    if (s.op === "insert") {
      const items = Array.isArray(s.payload) ? s.payload : [s.payload];
      const created = items.map((it) => ({ id: uid(), created_at: nowISO(), ...(DEFAULTS[table] || {}), ...it }));
      rows.push(...created);
      const data = s.single ? created[0] : created;
      return { data: s._returnRows || s.single ? data : null, error: null };
    }
    if (s.op === "update") {
      const updated = [];
      rows.forEach((row) => { if (matches(row, s.filters)) { Object.assign(row, s.payload); updated.push({ ...row }); } });
      const data = s.single ? (updated[0] || null) : updated;
      return { data: s._returnRows || s.single ? data : null, error: null };
    }
    if (s.op === "delete") {
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], s.filters)) rows.splice(i, 1);
      // cascade for rounds -> round_entries
      if (table === "rounds") {
        const ids = new Set(rows.map((r) => r.id));
        db.round_entries = db.round_entries.filter((e) => ids.has(e.round_id));
      }
      return { data: null, error: null };
    }
    // select
    let out = rows.filter((row) => matches(row, s.filters)).map((r) => ({ ...r }));
    for (const o of [...s.orders].reverse()) out.sort((a, b) => {   // stable multi-key
      const av = a[o.col], bv = b[o.col];
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return o.asc ? cmp : -cmp;
    });
    // nested embed: "..., round_entries(*)"
    if (/round_entries\(\*\)/.test(s.selectStr) && table === "rounds") {
      out = out.map((r) => ({ ...r, round_entries: db.round_entries.filter((e) => e.round_id === r.id).map((e) => ({ ...e })) }));
    }
    if (s.rangeFrom != null) out = out.slice(s.rangeFrom, s.rangeTo + 1);
    else if (s.limitN != null) out = out.slice(0, s.limitN);
    if (s.single) return { data: out[0] || null, error: null };
    return { data: out, error: null };
  } catch (e) {
    return { data: null, error: { message: String(e.message || e) } };
  }
}

export function createDemoClient() {
  const db = seed();
  const client = {
    from(table) { return query(db, table); },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    removeChannel() {},
    functions: { invoke: async () => ({ data: null, error: null }) }, // push no-op in demo
    storage: { from: () => ({ upload: async () => ({ error: { message: "demo mode — no storage" } }), remove: async () => ({ data: null, error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
    _db: db,
  };
  // Demo-only handle so the app's in-memory data can be inspected/crafted from
  // the console during testing. Never present in the real (Supabase) app.
  if (typeof window !== "undefined") window.__ppDemo = client;
  return client;
}
