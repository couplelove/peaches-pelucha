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

/* ---- the Game Room: pull up a seat for Phase 10 or Poker (reuses the exact
   private-game code, scoped to room="game-room"). Poker seats up to 4. ---- */
function GameRoom({ client, me, players, flash, api, world, crowd, onBack }) {
  const [game, setGame] = useState(() => localStorage.getItem("pp.roomGame") || "phase10");
  const pick = (g) => { localStorage.setItem("pp.roomGame", g); setGame(g); };
  const faces = [me, ...crowd.filter((p) => p.id !== me.id)].slice(0, 6);
  return html`<div class="gr">
    <div class="gr-bar">
      <button class="cback dark" onClick=${onBack}>‹ Map</button>
      <div class="gr-title">${world.emoji} ${world.name}</div>
      <div class="gr-here">${faces.map((p, i) => html`<span class=${`gr-av ${i === 0 ? "me" : ""}`} key=${i} title=${p.name || ""}>${p.emoji || "👤"}</span>`)}</div>
    </div>
    <div class="gameswitch gr-switch">
      <button class=${game === "phase10" ? "on" : ""} onClick=${() => pick("phase10")}>🎴 Phase 10</button>
      <button class=${game === "poker" ? "on" : ""} onClick=${() => pick("poker")}>🃏 Poker · up to 4</button>
    </div>
    <div class="gr-body">
      ${game === "phase10"
        ? html`<${PlayTab} client=${client} players=${players} me=${me} api=${api} flash=${flash} room="game-room" />`
        : html`<${PokerTab} client=${client} me=${me} players=${players} flash=${flash} room="game-room" />`}
    </div>
  </div>`;
}

/* ---- happenings carousel: anyone drops an event; one-tap RSVP + who's in ---- */
const EV_EMOJI = ["🎉", "🍿", "☕", "🍻", "🥾", "🏖️", "🎮", "🍽️", "🎶", "🛍️", "💪", "✨"];
function CommonsEvents({ client, me, world }) {
  const [events, setEvents] = useState(null);
  const [idx, setIdx] = useState(0);
  const [composing, setComposing] = useState(false);
  const [f, setF] = useState({ title: "", place: "", when_txt: "", emoji: "🎉" });
  const paused = useRef(0);

  const load = useCallback(async () => {
    const { data } = await client.from("world_events").select("*").eq("world_slug", world.slug).order("created_at", { ascending: false }).limit(30);
    setEvents(data || []);
  }, [client, world.slug]);

  useEffect(() => {
    load();
    let ch = null;
    try { ch = client.channel("we-" + world.slug).on("postgres_changes", { event: "*", schema: "public", table: "world_events", filter: `world_slug=eq.${world.slug}` }, () => load()).subscribe(); } catch {}
    return () => { try { ch && client.removeChannel(ch); } catch {} };
  }, [client, world.slug, load]);

  // auto-rotate the carousel (paused briefly after you interact)
  useEffect(() => {
    if (!events || events.length < 2 || composing) return;
    const t = setInterval(() => { if (Date.now() - paused.current > 6000) setIdx((i) => (i + 1) % events.length); }, 4500);
    return () => clearInterval(t);
  }, [events, composing]);

  const go = (n) => { paused.current = Date.now(); setIdx(((n % (events.length || 1)) + (events.length || 1)) % (events.length || 1)); };

  const post = async () => {
    const title = f.title.trim(); if (!title) return;
    setComposing(false); setIdx(0); paused.current = Date.now();
    await client.from("world_events").insert({ world_slug: world.slug, title, place: f.place.trim() || null, when_txt: f.when_txt.trim() || null, emoji: f.emoji, created_by: me.id, creator_name: me.name, creator_emoji: me.emoji });
    setF({ title: "", place: "", when_txt: "", emoji: "🎉" });
    load();
  };
  const toggleJoin = async (ev) => {
    paused.current = Date.now();
    const list = ev.joined || [];
    const mine = list.find((j) => j.id === me.id);
    const next = mine ? list.filter((j) => j.id !== me.id) : [...list, { id: me.id, name: me.name, emoji: me.emoji, at: new Date().toISOString() }];
    setEvents((es) => (es || []).map((x) => x.id === ev.id ? { ...x, joined: next } : x));   // optimistic
    await client.from("world_events").update({ joined: next }).eq("id", ev.id);
  };
  const remove = async (ev) => { setEvents((es) => (es || []).filter((x) => x.id !== ev.id)); await client.from("world_events").delete().eq("id", ev.id); };

  if (events === null) return null;
  if (composing) {
    return html`<div class="we-wrap">
      <div class="we-compose">
        <div class="we-emojis">${EV_EMOJI.map((e) => html`<button key=${e} class=${f.emoji === e ? "on" : ""} onClick=${() => setF({ ...f, emoji: e })}>${e}</button>`)}</div>
        <input class="we-in" value=${f.title} placeholder="What's happening? (e.g. beach day)" maxlength="60" onInput=${(e) => setF({ ...f, title: e.target.value })} />
        <div class="we-row">
          <input class="we-in" value=${f.place} placeholder="where (optional)" maxlength="40" onInput=${(e) => setF({ ...f, place: e.target.value })} />
          <input class="we-in" value=${f.when_txt} placeholder="when (optional)" maxlength="30" onInput=${(e) => setF({ ...f, when_txt: e.target.value })} />
        </div>
        <div class="we-row">
          <button class="btn ghost" onClick=${() => setComposing(false)}>Cancel</button>
          <button class="btn" disabled=${!f.title.trim()} onClick=${post}>Share it</button>
        </div>
      </div>
    </div>`;
  }
  if (!events.length) {
    return html`<div class="we-wrap"><button class="we-empty" onClick=${() => setComposing(true)}>＋ Share something to do — anyone can join</button></div>`;
  }
  const ev = events[Math.min(idx, events.length - 1)];
  const joined = ev.joined || [];
  const mineIn = joined.some((j) => j.id === me.id);
  return html`<div class="we-wrap">
    <div class="we-card" style=${`--wc:${world.color}`} key=${ev.id}>
      <button class="we-x" title="remove" onClick=${() => remove(ev)}>✕</button>
      <div class="we-emoji">${ev.emoji}</div>
      <div class="we-main">
        <div class="we-title">${ev.title}</div>
        <div class="we-meta">${[ev.place && `📍 ${ev.place}`, ev.when_txt && `🕒 ${ev.when_txt}`].filter(Boolean).join(" · ") || `by ${ev.creator_name || "someone"}`}</div>
        <div class="we-join">
          <div class="we-faces">${joined.slice(0, 5).map((j) => html`<span key=${j.id} title=${j.name}>${j.emoji || "👤"}</span>`)}${joined.length ? html`<span class="we-count">${joined.length} going</span>` : html`<span class="we-count">be the first</span>`}</div>
          <button class=${`we-rsvp ${mineIn ? "in" : ""}`} onClick=${() => toggleJoin(ev)}>${mineIn ? "Going ✓" : "Join"}</button>
        </div>
      </div>
    </div>
    <div class="we-foot">
      <div class="we-dots">${events.map((_, i) => html`<span key=${i} class=${i === idx ? "on" : ""} onClick=${() => go(i)}></span>`)}</div>
      <button class="we-add" onClick=${() => setComposing(true)}>＋ Share</button>
    </div>
  </div>`;
}
