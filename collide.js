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
  const chRef = useRef(null);
  const locRef = useRef("map");

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
    return html`<div class="collide croom" style=${`--wc:${room.color}`}>
      <div class="cstars">${stars.map((s, i) => html`<span key=${i} style=${`left:${s.x}%;top:${s.y}%;width:${s.s}px;height:${s.s}px;opacity:${s.o};animation-delay:${s.d}s`}></span>`)}</div>
      <button class="cback" onClick=${() => setRoom(null)}>‹ Map</button>
      <div class="croom-inner">
        <div class="croom-orb" style=${`--wc:${room.color}`}>${room.emoji}</div>
        <h1 class="croom-name">${room.name}</h1>
        <p class="croom-blurb">${room.blurb || ""}</p>
        <div class="croom-here">
          <div class="eyebrow" style="color:rgba(255,255,255,.55)">Here now</div>
          <div class="cavatars">
            <span class="cav me" title=${me.name}>${me.emoji}</span>
            ${crowd.filter((p) => p.id !== me.id).map((p) => html`<span class="cav" key=${p.id} title=${p.name}>${p.emoji || "👤"}</span>`)}
          </div>
          <div class="tiny" style="color:rgba(255,255,255,.45);margin-top:8px">
            ${demo ? "Public presence is live once you're online with others." : crowd.length <= 1 ? "You're the first one here. More are coming." : `${crowd.length} here right now.`}
          </div>
        </div>
        <div class="croom-soon">🚧 Public worlds are just being built. Soon you'll hang out, react, and meet people here.</div>
      </div>
    </div>`;
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
