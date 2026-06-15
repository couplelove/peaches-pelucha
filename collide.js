import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useMemo, useRef, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

/* 🌌 Collide — the public meta-space. You STEP OUT of your private world into a
   map of worlds (circle-portals). Your private world is on the map too, shown
   only to you for now. This is the scaffold for going beyond one couple:
   public squares, friends' worlds, seeing one another. Presence is wired so two
   phones in Collide already see each other; avatars/movement come later. */

export function Collide({ client, me, players, onEnterHome, flash }) {
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

  // ---- inside a public world: a real, live town square ----
  if (room) {
    return html`<${WorldRoom} client=${client} me=${me} world=${room} demo=${demo}
      crowd=${peopleAt(`world:${room.slug}`)} floats=${floats} onReact=${sendReact} onBack=${() => setRoom(null)} />`;
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
