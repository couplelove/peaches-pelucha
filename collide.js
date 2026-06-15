import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useMemo, useRef, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { PlayTab } from "./game.js";
import { PokerTab } from "./poker.js";

const html = htm.bind(h);

/* 🌌 Collide — the public meta-space. You STEP OUT of your private world into a
   map of worlds (circle-portals). Your private world is on the map too, shown
   only to you for now. This is the scaffold for going beyond one couple:
   public squares, friends' worlds, seeing one another. Presence is wired so two
   phones in Collide already see each other; avatars/movement come later. */

export function Collide({ client, me, players, onEnterHome, flash, api }) {
  const demo = !!client._db;
  const [worlds, setWorlds] = useState(null);
  const [room, setRoom] = useState(null);        // a public world you've entered
  const [here, setHere] = useState({});          // presence: key → metas[]
  const [floats, setFloats] = useState([]);      // ambient reaction emojis rising
  const chRef = useRef(null);
  const locRef = useRef("map");

  const spawnFloat = useCallback((emoji) => {
    const id = Math.random().toString(36).slice(2);
    setFloats((f) => [...f, { id, emoji, x: 8 + Math.random() * 78 }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 2400);
  }, []);
  const sendReact = useCallback((emoji) => {
    spawnFloat(emoji);
    const ch = chRef.current;
    if (ch && ch.send) ch.send({ type: "broadcast", event: "react", payload: { emoji, world: locRef.current, by: me.id } });
  }, [spawnFloat, me.id]);

  const load = useCallback(async () => {
    const { data } = await client.from("worlds").select("*").order("created_at");
    setWorlds(data || []);
  }, [client]);

  useEffect(() => {
    load();
    let ch = null;
    try {
      ch = client.channel("pp-worlds").on("postgres_changes", { event: "*", schema: "public", table: "worlds" }, () => load()).subscribe();
    } catch {}
    return () => { try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load]);

  // presence — who else is in Collide, and where (map vs a world)
  const loc = room ? `world:${room.slug}` : "map";
  useEffect(() => { locRef.current = loc; const ch = chRef.current; if (ch && ch.track) ch.track({ name: me.name, emoji: me.emoji, loc }).catch(() => {}); }, [loc, me]);
  useEffect(() => {
    if (demo) { setHere({ [me.id]: [{ name: me.name, emoji: me.emoji, loc: "map" }] }); return; }
    let ch = null;
    try {
      ch = client.channel("collide", { config: { presence: { key: me.id } } });
      chRef.current = ch;
      ch.on("presence", { event: "sync" }, () => setHere({ ...ch.presenceState() }))
        .on("broadcast", { event: "react" }, ({ payload }) => { if (payload && payload.world === locRef.current) spawnFloat(payload.emoji); })
        .subscribe(async (s) => { if (s === "SUBSCRIBED" && ch.track) { try { await ch.track({ name: me.name, emoji: me.emoji, loc: locRef.current }); } catch {} } });
    } catch {}
    return () => { chRef.current = null; try { ch && client.removeChannel(ch); } catch {} };
  }, [client, me.id, demo]);

  const people = useMemo(() => Object.entries(here).map(([id, metas]) => ({ id, ...((metas && metas[0]) || {}) })), [here]);
  const peopleAt = (l) => people.filter((p) => p.loc === l);

  const stars = useMemo(() => Array.from({ length: 46 }, (_, i) => ({
    x: Math.random() * 100, y: Math.random() * 100, s: 0.6 + Math.random() * 1.6, d: (i % 7) * 0.4, o: 0.25 + Math.random() * 0.5,
  })), []);

  const enter = (w) => {
    if (w.kind === "private" && w.slug === "peaches-pelucha") { onEnterHome(); return; }
    setRoom(w);
  };

  // ---- inside a public world ----
  if (room) {
    const crowd = peopleAt(`world:${room.slug}`);
    if (room.slug === "game-room") {
      return html`<${GameRoom} client=${client} me=${me} players=${players} flash=${flash} api=${api}
        world=${room} crowd=${crowd} onBack=${() => setRoom(null)} />`;
    }
    return html`<${WorldRoom} client=${client} me=${me} world=${room} demo=${demo}
      crowd=${crowd} floats=${floats} onReact=${sendReact} onBack=${() => setRoom(null)} />`;
  }

  // ---- the map ----
  const onMap = peopleAt("map");
  return html`<div class="collide">
    <div class="cstars">${stars.map((s, i) => html`<span key=${i} style=${`left:${s.x}%;top:${s.y}%;width:${s.s}px;height:${s.s}px;opacity:${s.o};animation-delay:${s.d}s`}></span>`)}</div>
    <div class="ctopbar">
      <button class="cback" onClick=${onEnterHome}>‹ Your world</button>
      <div class="ctitle">✦ Collide</div>
      <div class="cspacer"></div>
    </div>
    <div class="csub">a map of worlds</div>

    <div class="cmap">
      ${worlds === null ? html`<div class="cloading">Charting the worlds…</div>`
        : worlds.map((w) => {
          const crowd = peopleAt(`world:${w.slug}`);
          const priv = w.kind === "private";
          return html`<button class=${`cworld ${priv ? "private" : ""}`} key=${w.id}
            style=${`left:${w.x * 100}%;top:${w.y * 100}%;--wc:${w.color}`} onClick=${() => enter(w)}>
            <span class="corb">${w.emoji}${priv ? html`<span class="clock">🔒</span>` : ""}</span>
            <span class="clabel">${w.name}</span>
            <span class="cmeta">${priv ? "only you can see this" : (crowd.length ? `${crowd.length} here` : "public")}</span>
          </button>`;
        })}
    </div>

    <div class="cpresence">
      <span class="cav me">${me.emoji}</span>
      ${onMap.filter((p) => p.id !== me.id).map((p) => html`<span class="cav" key=${p.id}>${p.emoji || "👤"}</span>`)}
      <span class="tiny" style="color:rgba(255,255,255,.5);margin-left:8px">${demo ? "you're exploring Collide" : onMap.length <= 1 ? "you're out here exploring" : `${onMap.length} exploring`}</span>
    </div>
  </div>`;
}

/* ---- a public world's interior: a persistent town-square chat + presence ---- */
function WorldRoom({ client, me, world, demo, crowd, floats, onReact, onBack }) {
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState("");
  const listRef = useRef(null);

  const load = useCallback(async () => {
    const { data } = await client.from("world_messages").select("*").eq("world_slug", world.slug).order("created_at").limit(120);
    setMsgs(data || []);
  }, [client, world.slug]);

  useEffect(() => {
    load();
    let ch = null;
    try {
      ch = client.channel("wm-" + world.slug)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "world_messages", filter: `world_slug=eq.${world.slug}` }, (p) => {
          const row = p.new;
          setMsgs((m) => {
            const a = m || [];
            if (a.some((x) => x.id === row.id)) return a;                       // already have it
            const pi = a.findIndex((x) => x.pending && x.player_id === row.player_id && x.text === row.text);
            if (pi >= 0) { const c = [...a]; c[pi] = row; return c; }            // swap my optimistic one
            return [...a, row];
          });
        }).subscribe();
    } catch {}
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    return () => { document.removeEventListener("visibilitychange", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, world.slug, load]);

  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs]);

  const send = async () => {
    const t = text.trim(); if (!t) return;
    setText("");
    const temp = { id: "tmp-" + Math.random().toString(36).slice(2), world_slug: world.slug, player_id: me.id, name: me.name, emoji: me.emoji, text: t, created_at: new Date().toISOString(), pending: true };
    setMsgs((m) => [...(m || []), temp]);
    const { data, error } = await client.from("world_messages").insert({ world_slug: world.slug, player_id: me.id, name: me.name, emoji: me.emoji, text: t }).select().single();
    if (error || !data) { setMsgs((m) => (m || []).filter((x) => x.id !== temp.id)); setText(t); return; }
    setMsgs((m) => (m || []).map((x) => x.id === temp.id ? data : x));
  };

  const faces = [me, ...crowd.filter((p) => p.id !== me.id)].slice(0, 6);
  return html`<div class="collide wr" style=${`--wc:${world.color}`}>
    <div class="wr-bar">
      <button class="cback" onClick=${onBack}>‹ Map</button>
      <div class="wr-title">${world.emoji} ${world.name}</div>
      <div class="wr-here">${faces.map((p, i) => html`<span class=${`cav ${i === 0 ? "me" : ""}`} key=${i} title=${p.name || ""}>${p.emoji || "👤"}</span>`)}</div>
    </div>

    <${CommonsEvents} client=${client} me=${me} world=${world} />

    <div class="wr-msgs" ref=${listRef}>
      ${msgs === null ? html`<div class="cloading">Loading the square…</div>`
        : msgs.length === 0 ? html`<div class="cloading">Quiet here. Say the first thing 👋</div>`
        : msgs.map((m) => html`<div class=${`wr-msg ${m.player_id === me.id ? "mine" : ""} ${m.pending ? "pending" : ""} ${!m.player_id ? "sys" : ""}`} key=${m.id}>
            ${m.player_id !== me.id && html`<span class="wr-who">${m.emoji} ${m.name}</span>`}
            <span class="wr-bub">${m.text}</span>
          </div>`)}
    </div>

    <div class="wr-react">${["👋", "😂", "🔥", "💗", "😮", "👏"].map((e) => html`<button key=${e} onClick=${() => onReact(e)}>${e}</button>`)}</div>
    <div class="wr-compose">
      <input value=${text} onInput=${(e) => setText(e.target.value)} placeholder="say something to the square…" maxlength="240"
        onKeyDown=${(e) => { if (e.key === "Enter") send(); }} />
      <button class="btn sm" disabled=${!text.trim()} onClick=${send}>Send</button>
    </div>

    ${floats.map((f) => html`<span key=${f.id} class="cfloat" style=${`left:${f.x}%`}>${f.emoji}</span>`)}
  </div>`;
}

/* ---- the Game Room: a LOBBY you opt into. See who's here + what they're up
   for, invite a player to a game, set yourself available/unavailable, leave.
   Accepting an invite drops you both into the shared room-scoped game. ---- */
const GR_GAMES = { phase10: { emoji: "🎴", name: "Phase 10" }, poker: { emoji: "🃏", name: "Poker" } };
function GameRoom({ client, me, players, flash, api, world, onBack }) {
  const demo = !!client._db;
  const [available, setAvailable] = useState(true);
  const [myGame, setMyGame] = useState(() => localStorage.getItem("pp.roomGame") || "phase10");
  const [inGame, setInGame] = useState(null);        // 'phase10'|'poker' while playing
  const [here, setHere] = useState({});              // lobby presence
  const [invite, setInvite] = useState(null);        // incoming {from,name,emoji,game}
  const [waiting, setWaiting] = useState(null);      // outgoing {to,name,game}
  const chRef = useRef(null);
  const meRef = useRef({});
  meRef.current = { name: me.name, emoji: me.emoji, game: myGame, available, inGame };

  const pickGame = (g) => { localStorage.setItem("pp.roomGame", g); setMyGame(g); };

  useEffect(() => {
    if (demo) { setHere({ [me.id]: [meRef.current] }); return; }
    let ch = null;
    try {
      ch = client.channel("gameroom", { config: { presence: { key: me.id } } });
      chRef.current = ch;
      ch.on("presence", { event: "sync" }, () => setHere({ ...ch.presenceState() }))
        .on("broadcast", { event: "gr" }, ({ payload }) => {
          if (!payload || payload.to !== me.id) return;
          if (payload.kind === "invite") setInvite({ from: payload.from, name: payload.name, emoji: payload.emoji, game: payload.game });
          else if (payload.kind === "accept") { setWaiting(null); setInGame(payload.game); }
          else if (payload.kind === "decline") { setWaiting(null); flash(`${payload.name} can't right now`); }
          else if (payload.kind === "cancel") setInvite((iv) => (iv && iv.from === payload.from ? null : iv));
        })
        .subscribe(async (s) => { if (s === "SUBSCRIBED" && ch.track) { try { await ch.track(meRef.current); } catch {} } });
    } catch {}
    return () => { chRef.current = null; try { ch && client.removeChannel(ch); } catch {} };
  }, [client, me.id, demo]);
  // keep my presence fresh as I toggle game/availability/playing
  useEffect(() => { const ch = chRef.current; if (ch && ch.track) ch.track(meRef.current).catch(() => {}); }, [myGame, available, inGame, me]);

  const send = (kind, to, extra = {}) => { const ch = chRef.current; if (ch && ch.send) ch.send({ type: "broadcast", event: "gr", payload: { kind, from: me.id, to, name: me.name, emoji: me.emoji, ...extra } }); };
  const invitePlayer = (p) => { setWaiting({ to: p.id, name: p.name, game: myGame }); send("invite", p.id, { game: myGame }); };
  const acceptInvite = () => { send("accept", invite.from, { game: invite.game }); setInGame(invite.game); setInvite(null); };
  const declineInvite = () => { send("decline", invite.from); setInvite(null); };
  const cancelWaiting = () => { if (waiting) send("cancel", waiting.to); setWaiting(null); };

  const others = players.filter((p) => p.id !== me.id);
  const presOf = (id) => { const m = here[id]; return m && m[0]; };

  // ---- in a game: render it (shared, room-scoped), with a ‹ back to lobby ----
  if (inGame) {
    return html`<div class="gr">
      <div class="gr-bar">
        <button class="cback dark" onClick=${() => setInGame(null)}>‹ Lobby</button>
        <div class="gr-title">${GR_GAMES[inGame].emoji} ${GR_GAMES[inGame].name}</div>
        <div style="width:64px"></div>
      </div>
      <div class="gr-body">
        ${inGame === "phase10"
          ? html`<${PlayTab} client=${client} players=${players} me=${me} api=${api} flash=${flash} room="game-room" />`
          : html`<${PokerTab} client=${client} me=${me} players=${players} flash=${flash} room="game-room" />`}
      </div>
    </div>`;
  }

  // ---- the lobby ----
  return html`<div class="gr">
    <div class="gr-bar">
      <button class="cback dark" onClick=${onBack}>‹ Leave</button>
      <div class="gr-title">🎲 Game Room</div>
      <div style="width:64px"></div>
    </div>
    <div class="gr-lobby">
      <div class="lobby-me">
        <div class="lm-head">${me.emoji} ${me.name} <span class="lm-you">you</span></div>
        <div class="lm-row"><span class="tiny muted">Up for</span>
          ${Object.entries(GR_GAMES).map(([g, info]) => html`<button class=${`gchip ${myGame === g ? "on" : ""}`} key=${g} onClick=${() => pickGame(g)}>${info.emoji} ${info.name}</button>`)}
        </div>
        <div class="lm-row">
          <button class=${`avail ${available ? "on" : ""}`} onClick=${() => setAvailable((a) => !a)}>${available ? "🟢 Available for invites" : "⚪️ Unavailable"}</button>
          <button class="btn sm ghost" onClick=${() => setInGame(myGame)}>Open ${GR_GAMES[myGame].emoji} →</button>
        </div>
      </div>

      <div class="weyebrow2">Who's here</div>
      ${others.length === 0
        ? html`<div class="lobby-empty">It's just you for now. Invite friends to Collide and they'll show up here.</div>`
        : others.map((p) => { const pr = presOf(p.id); const present = !!pr; const av = present && pr.available && !pr.inGame; const sub = !present ? "not in the room" : pr.inGame ? `playing ${GR_GAMES[pr.inGame]?.name || "a game"}` : pr.available ? `up for ${GR_GAMES[pr.game]?.name || "a game"}` : "unavailable"; return html`<div class=${`lobby-row ${present ? "" : "off"}`} key=${p.id}>
            <span class="lr-emoji">${p.emoji}</span>
            <div class="lr-main"><div class="lr-name">${p.name}</div><div class="lr-sub">${sub}</div></div>
            <button class="btn sm lr-invite" disabled=${!av || !!waiting} onClick=${() => invitePlayer(p)}>Invite</button>
          </div>`; })}
      ${demo ? html`<div class="tiny muted" style="margin-top:10px">Invites light up when your partner is in the room too. Tap “Open” to play now.</div>` : ""}
    </div>

    ${waiting && html`<div class="modal-bg gr-modal" onClick=${(e) => { if (e.target.classList.contains("modal-bg")) cancelWaiting(); }}>
      <div class="modal gr-sheet"><div class="handle"></div>
        <div class="gs-wait">Waiting for <b>${waiting.name}</b> to accept <b>${GR_GAMES[waiting.game].name}</b>…</div>
        <button class="btn ghost block mt" onClick=${cancelWaiting}>Cancel invite</button>
      </div>
    </div>`}
    ${invite && html`<div class="modal-bg gr-modal">
      <div class="modal gr-sheet"><div class="handle"></div>
        <div class="gs-title">${invite.emoji} ${invite.name}</div>
        <div class="gs-sub">invites you to play <b>${GR_GAMES[invite.game].name}</b></div>
        <button class="btn block mt" onClick=${acceptInvite}>Join ${GR_GAMES[invite.game].emoji}</button>
        <button class="linkbtn block" style="width:100%" onClick=${declineInvite}>Not now</button>
      </div>
    </div>`}
  </div>`;
}

/* ---- happenings: an Upcoming list — anyone drops an event, one-tap RSVP ---- */
const EV_EMOJI = ["🎉", "🍿", "☕", "🍻", "🥾", "🏖️", "🎮", "🍽️", "🎶", "🛍️", "💪", "✨"];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function CommonsEvents({ client, me, world }) {
  const [events, setEvents] = useState(null);
  const [composing, setComposing] = useState(false);
  const [f, setF] = useState({ title: "", place: "", when_txt: "", when_at: "", emoji: "🎉" });
  const [view, setView] = useState("week");          // 'week' | 'calendar'
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selDay, setSelDay] = useState(() => ymd(new Date()));
  const [guestId, setGuestId] = useState(null);      // which event's guest list is open

  const load = useCallback(async () => {
    const { data } = await client.from("world_events").select("*").eq("world_slug", world.slug).order("created_at", { ascending: false }).limit(40);
    setEvents(data || []);
  }, [client, world.slug]);

  useEffect(() => {
    load();
    let ch = null;
    try { ch = client.channel("we-" + world.slug).on("postgres_changes", { event: "*", schema: "public", table: "world_events", filter: `world_slug=eq.${world.slug}` }, () => load()).subscribe(); } catch {}
    return () => { try { ch && client.removeChannel(ch); } catch {} };
  }, [client, world.slug, load]);

  const today = ymd(new Date());
  const weekEnd = ymd(new Date(Date.now() + 7 * 864e5));
  const dayDiff = (w) => Math.round((new Date(w + "T00:00") - new Date(today + "T00:00")) / 864e5);
  const dateLabel = (w) => { if (!w) return "anytime"; const n = dayDiff(w); if (n === 0) return "today"; if (n === 1) return "tomorrow"; return new Date(w + "T00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); };
  const sortFn = (a, b) => ((a.when_at || "9999") < (b.when_at || "9999") ? -1 : 1);
  const all = (events || []).slice().sort(sortFn);
  const week = all.filter((e) => !e.when_at || (e.when_at >= today && e.when_at <= weekEnd)).sort(sortFn);
  const undated = all.filter((e) => !e.when_at);
  const byDay = {}; all.forEach((e) => { if (e.when_at) (byDay[e.when_at] = byDay[e.when_at] || []).push(e); });

  const post = async () => {
    const title = f.title.trim(); if (!title) return;
    setComposing(false);
    await client.from("world_events").insert({ world_slug: world.slug, title, place: f.place.trim() || null, when_txt: f.when_txt.trim() || null, when_at: f.when_at || null, emoji: f.emoji, created_by: me.id, creator_name: me.name, creator_emoji: me.emoji });
    setF({ title: "", place: "", when_txt: "", when_at: "", emoji: "🎉" });
    load();
  };
  const toggleJoin = async (ev) => {
    const list = ev.joined || [];
    const mine = list.find((j) => j.id === me.id);
    const next = mine ? list.filter((j) => j.id !== me.id) : [...list, { id: me.id, name: me.name, emoji: me.emoji, at: new Date().toISOString() }];
    setEvents((es) => (es || []).map((x) => x.id === ev.id ? { ...x, joined: next } : x));
    await client.from("world_events").update({ joined: next }).eq("id", ev.id);
  };
  const remove = async (ev) => { setEvents((es) => (es || []).filter((x) => x.id !== ev.id)); await client.from("world_events").delete().eq("id", ev.id); };

  if (events === null) return null;
  if (composing) {
    return html`<div class="we-wrap"><div class="we-compose">
      <div class="we-emojis">${EV_EMOJI.map((e) => html`<button key=${e} class=${f.emoji === e ? "on" : ""} onClick=${() => setF({ ...f, emoji: e })}>${e}</button>`)}</div>
      <input class="we-in" value=${f.title} placeholder="What's happening? (e.g. beach day)" maxlength="60" onInput=${(e) => setF({ ...f, title: e.target.value })} />
      <div class="we-row">
        <input class="we-in" value=${f.place} placeholder="where (optional)" maxlength="40" onInput=${(e) => setF({ ...f, place: e.target.value })} />
        <input class="we-in" type="date" value=${f.when_at} onInput=${(e) => setF({ ...f, when_at: e.target.value })} />
      </div>
      <input class="we-in" value=${f.when_txt} placeholder="time / note (optional, e.g. 8pm)" maxlength="30" onInput=${(e) => setF({ ...f, when_txt: e.target.value })} />
      <div class="we-row">
        <button class="btn ghost" onClick=${() => setComposing(false)}>Cancel</button>
        <button class="btn" disabled=${!f.title.trim()} onClick=${post}>Share it</button>
      </div>
    </div></div>`;
  }

  const eventRow = (ev) => {
    const joined = ev.joined || [];
    const mineIn = joined.some((j) => j.id === me.id);
    return html`<div class="we-up-row" key=${ev.id}>
      <span class="we-up-emoji">${ev.emoji}</span>
      <div class="we-up-main">
        <div class="we-up-title">${ev.title}</div>
        <div class="we-up-meta">${[dateLabel(ev.when_at), ev.place, ev.when_txt].filter(Boolean).join(" · ")}</div>
        <button class="we-guests" onClick=${() => setGuestId(ev.id)}>👥 ${joined.length ? `${joined.length} going — see who` : "no one yet"}</button>
      </div>
      <button class=${`we-up-join ${mineIn ? "in" : ""}`} onClick=${() => toggleJoin(ev)}>${mineIn ? "Going ✓" : "Join"}</button>
      <button class="we-up-x" title="remove" onClick=${() => remove(ev)}>✕</button>
    </div>`;
  };

  // calendar grid for the viewed month
  const y = month.getFullYear(), m = month.getMonth();
  const firstWd = new Date(y, m, 1).getDay();
  const dim = new Date(y, m + 1, 0).getDate();
  const cells = []; for (let i = 0; i < firstWd; i++) cells.push(null); for (let d = 1; d <= dim; d++) cells.push(d);
  const cellStr = (d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const monthLabel = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const guest = guestId ? all.find((e) => e.id === guestId) : null;

  return html`<div class="we-wrap">
    <div class="we-head">
      <div class="we-toggle">
        <button class=${view === "week" ? "on" : ""} onClick=${() => setView("week")}>This week</button>
        <button class=${view === "calendar" ? "on" : ""} onClick=${() => setView("calendar")}>Calendar</button>
      </div>
      <button class="we-add" onClick=${() => setComposing(true)}>＋ Share</button>
    </div>

    ${view === "week"
      ? (week.length === 0
          ? html`<button class="we-empty" onClick=${() => setComposing(true)}>Nothing this week — ＋ share something to do</button>`
          : html`<div class="we-up">${week.map(eventRow)}</div>`)
      : html`<div class="we-cal">
          <div class="we-cal-head">
            <button class="we-cal-nav" onClick=${() => setMonth(new Date(y, m - 1, 1))}>‹</button>
            <span>${monthLabel}</span>
            <button class="we-cal-nav" onClick=${() => setMonth(new Date(y, m + 1, 1))}>›</button>
          </div>
          <div class="we-cal-grid">
            ${["S", "M", "T", "W", "T", "F", "S"].map((w, i) => html`<div class="we-cal-wd" key=${"wd" + i}>${w}</div>`)}
            ${cells.map((d, i) => d === null
              ? html`<div class="we-cal-cell empty" key=${"c" + i}></div>`
              : (() => { const ds = cellStr(d); const evs = byDay[ds] || []; return html`<button key=${"c" + i} class=${`we-cal-cell ${ds === today ? "today" : ""} ${ds === selDay ? "sel" : ""} ${evs.length ? "has" : ""}`} onClick=${() => setSelDay(ds)}>
                  <span class="we-cal-d">${d}</span>${evs.length ? html`<span class="we-cal-dot">${evs.length > 1 ? evs.length : evs[0].emoji}</span>` : ""}
                </button>`; })())}
          </div>
          <div class="we-day-events">
            <div class="we-up-head2">${dateLabel(selDay) === "anytime" ? selDay : dateLabel(selDay)}</div>
            ${(byDay[selDay] || []).length
              ? (byDay[selDay]).map(eventRow)
              : html`<div class="we-day-empty">Nothing planned · <button class="we-dayadd" onClick=${() => { setF({ ...f, when_at: selDay }); setComposing(true); }}>＋ add an event</button></div>`}
            ${undated.length ? html`<div class="we-up-head2" style="margin-top:12px">Anytime</div>${undated.map(eventRow)}` : ""}
          </div>
        </div>`}

    ${guest && html`<div class="modal-bg" onClick=${(e) => { if (e.target.classList.contains("modal-bg")) setGuestId(null); }}>
      <div class="we-guestsheet">
        <div class="wg-title">${guest.emoji} ${guest.title}</div>
        <div class="wg-sub">${[dateLabel(guest.when_at), guest.place, guest.when_txt].filter(Boolean).join(" · ")}</div>
        <div class="wg-head">Going · ${(guest.joined || []).length}</div>
        ${(guest.joined || []).length
          ? html`<div class="wg-list">${(guest.joined || []).map((j) => html`<div class="wg-row" key=${j.id}><span class="wg-em">${j.emoji || "👤"}</span><span class="wg-nm">${j.name || "Someone"}</span></div>`)}</div>`
          : html`<div class="wg-empty">No one's in yet — be the first to join.</div>`}
        <button class="btn block mt" onClick=${() => { toggleJoin(guest); }}>${(guest.joined || []).some((j) => j.id === me.id) ? "Leave" : "Join"}</button>
        <button class="linkbtn block" style="width:100%" onClick=${() => setGuestId(null)}>Close</button>
      </div>
    </div>`}
  </div>`;
}
