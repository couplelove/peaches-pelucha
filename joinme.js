import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useRef, useMemo, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { notifyTurn } from "./push.js";

const html = htm.bind(h);

/* 🧘 Join Me — a real-time space you can only use when you're BOTH in the app.
   Presence (Supabase realtime) gates it. Two activities:
   • Breathe together — a synchronized breathing session derived from a shared
     `startedAt` timestamp (lockstep with no constant messaging).
   • Listen together — a shared YouTube "radio" seeded from a hat of songs/
     artists; one phone (host) DJs + writes the now-playing row, both mirror it. */

const INHALE = 4, HOLD = 2, EXHALE = 6, CYCLE = INHALE + HOLD + EXHALE;   // 12s breath
const PRESETS = [1, 3, 5];        // minutes
const PROMPT_EVERY = 18;          // seconds between partner prompts
const PROMPTS = [
  "Picture the way they smile at you.",
  "Recall a moment you felt safe with them.",
  "Send them one calm, loving thought.",
  "Remember why you chose each other.",
  "Imagine them breathing with you, right now.",
  "Hold gratitude for something they did this week.",
  "Picture reaching for their hand.",
  "Wish them peace, wherever they are.",
  "Soften — and carry them with you.",
];

const phaseAt = (el) => { const t = el % CYCLE; return t < INHALE ? "Breathe in" : t < INHALE + HOLD ? "Hold" : "Breathe out"; };
const mmss = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

// lazy YouTube IFrame API (shared once)
let ytReady = null;
function loadYT() {
  if (ytReady) return ytReady;
  ytReady = new Promise((res) => {
    if (window.YT && window.YT.Player) return res(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { try { prev && prev(); } catch {} res(window.YT); };
    const tag = document.createElement("script"); tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return ytReady;
}
async function ytSearch(client, q, limit) {
  try { const { data } = await client.functions.invoke("yt-search", { body: { q, limit } }); return (data && data.results) || []; }
  catch { return []; }
}

export function JoinMe({ client, me, players, flash }) {
  const demo = !!client._db;
  const partner = players.find((p) => p.id !== me.id) || null;
  const [here, setHere] = useState({});
  const [session, setSession] = useState(null);   // breathe { startedAt, durationSec }
  const [mode, setMode] = useState(null);          // null lobby | 'breathe' | 'listen'
  const [now, setNow] = useState(Date.now());
  const chRef = useRef(null);
  const meInfo = { name: me.name, emoji: me.emoji };

  useEffect(() => {
    if (demo) { const m = { [me.id]: true }; if (partner) m[partner.id] = true; setHere(m); return; }
    let ch = client.channel("joinme", { config: { presence: { key: me.id } } });
    chRef.current = ch;
    ch.on("presence", { event: "sync" }, () => {
      const st = ch.presenceState(); const map = {}; let peerSession = null;
      Object.entries(st).forEach(([k, metas]) => {
        map[k] = true;
        const meta = metas && metas[0];
        if (k !== me.id && meta && meta.session && meta.session.startedAt + meta.session.durationSec * 1000 > Date.now()) peerSession = meta.session;
      });
      setHere(map);
      if (peerSession) setSession((cur) => cur || peerSession);
    })
      .on("broadcast", { event: "jm" }, ({ payload }) => {
        if (!payload) return;
        if (payload.kind === "start") setSession({ startedAt: payload.startedAt, durationSec: payload.durationSec });
        else if (payload.kind === "stop") setSession(null);
      })
      .subscribe(async (s) => { if (s === "SUBSCRIBED" && ch.track) { try { await ch.track(meInfo); } catch {} } });
    return () => { chRef.current = null; try { client.removeChannel(ch); } catch {} };
  }, [client, me.id, demo]);

  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [session]);

  const partnerHere = demo ? true : !!(partner && here[partner.id]);

  const send = (payload) => { const ch = chRef.current; if (ch && ch.send) ch.send({ type: "broadcast", event: "jm", payload }); };
  const track = (extra) => { const ch = chRef.current; if (ch && ch.track) ch.track({ ...meInfo, ...extra }).catch(() => {}); };
  const start = (min) => { const s = { startedAt: Date.now(), durationSec: min * 60 }; setSession(s); send({ kind: "start", ...s }); track({ session: s }); };
  const end = () => { setSession(null); send({ kind: "stop" }); track({ session: null }); };
  const nudge = () => { if (partner && !demo) { notifyTurn(client, partner.id, "Join Me 🧘", `${me.name} wants a moment together`); flash(`Nudged ${partner.name} 🧘`); } };

  const breathDelay = useMemo(() => session ? -(((Date.now() - session.startedAt) / 1000) % CYCLE) : 0, [session && session.startedAt]);

  // ---------- breathe: active session ----------
  if (session) {
    const elapsed = (now - session.startedAt) / 1000;
    const remaining = session.durationSec - elapsed;
    if (remaining <= 0) {
      return html`<div class="card jm" data-noswipe>
        <div class="jm-done">
          <div class="jm-done-mark">🤍</div>
          <div class="jm-done-title">Together.</div>
          <div class="tiny muted">You breathed with ${partner ? partner.name : "your love"} for ${Math.round(session.durationSec / 60)} min.</div>
          <div class="jm-done-actions">
            <button class="btn ghost" onClick=${end}>Done</button>
            <button class="btn" onClick=${() => start(session.durationSec / 60)}>Again</button>
          </div>
        </div>
      </div>`;
    }
    const pIdx = Math.floor(elapsed / PROMPT_EVERY);
    return html`<div class="card jm" data-noswipe>
      <div class="jm-top"><span class="jm-count tnum">${mmss(remaining)}</span><button class="linkbtn" onClick=${end}>End</button></div>
      <div class="jm-orbit">
        <div class="jm-ring"></div>
        <div class="jm-circle" style=${`animation-delay:${breathDelay}s`}></div>
        <div class="jm-phase">${phaseAt(elapsed)}</div>
      </div>
      <div class="jm-prompt" key=${pIdx}>${PROMPTS[pIdx % PROMPTS.length]}</div>
      <div class="jm-with">${me.emoji}${partner ? " · " + partner.emoji : ""} · breathing together</div>
    </div>`;
  }

  // ---------- not both here → waiting ----------
  if (!partnerHere) {
    return html`<div class="card jm">
      <div class="eyebrow">Join Me 🧘</div>
      <h2>A moment, together</h2>
      <p class="jm-lede">Join Me lights up when you're both in the app at the same time. ${partner ? partner.name : "Your partner"} isn't here right now.</p>
      <div class="jm-waiting"><span class="jm-wait-pulse"></span><span class="jm-wait-av">${partner ? partner.emoji : "🫂"}</span></div>
      ${partner && !demo ? html`<button class="btn block" onClick=${nudge}>🧘 Invite ${partner.name} over</button>` : ""}
    </div>`;
  }

  // ---------- both here: Listen ----------
  if (mode === "listen") {
    return html`<${ListenTogether} client=${client} me=${me} partner=${partner} flash=${flash} onBack=${() => setMode(null)} />`;
  }

  // ---------- both here: Breathe presets ----------
  if (mode === "breathe") {
    return html`<div class="card jm" data-noswipe>
      <button class="dd-back" onClick=${() => setMode(null)}>‹ Join Me</button>
      <h2>Breathe together</h2>
      <p class="jm-lede">A quiet moment with ${partner ? partner.name : "your love"}. Pick a length — you'll both drop in together.</p>
      <div class="jm-presets">
        ${PRESETS.map((m) => html`<button class="jm-preset tap" key=${m} onClick=${() => start(m)}>${m} min</button>`)}
      </div>
    </div>`;
  }

  // ---------- both here: activity chooser ----------
  return html`<div class="card jm">
    <div class="eyebrow">Join Me 🧘</div>
    <h2>You're both here</h2>
    <p class="jm-lede">A little space that only works when you're together. Pick something.</p>
    <div class="jm-acts">
      <button class="jm-act tap" onClick=${() => setMode("listen")}>
        <span class="jm-act-em">🎧</span><span class="jm-act-t">Listen together</span>
        <span class="jm-act-s">Your shared radio</span>
      </button>
      <button class="jm-act tap" onClick=${() => setMode("breathe")}>
        <span class="jm-act-em">🧘</span><span class="jm-act-t">Breathe together</span>
        <span class="jm-act-s">A calm minute</span>
      </button>
    </div>
    <div class="jm-here">🟢 You're both here</div>
  </div>`;
}

/* ----------------------------------------------------- Listen Together ----- */
function ListenTogether({ client, me, partner, flash, onBack }) {
  const demo = !!client._db;
  const isHost = !partner || me.id < partner.id;   // deterministic; only the host DJs + writes state
  const [seeds, setSeeds] = useState([]);
  const [term, setTerm] = useState("");
  const [adding, setAdding] = useState(false);
  const [rs, setRs] = useState(null);              // shared { videoId, title, startedAt, playing, pausedAt }
  const [ready, setReady] = useState(false);
  const playerRef = useRef(null);
  const elRef = useRef(null);
  const rowRef = useRef(null);                     // radio_state row { id, version }
  const host = useRef({ queue: [], idx: -1, building: false });
  const rsRef = useRef(null); useEffect(() => { rsRef.current = rs; }, [rs]);

  const loadSeeds = useCallback(async () => {
    const { data } = await client.from("radio_seeds").select("*").order("created_at");
    setSeeds(data || []);
  }, [client]);
  const loadState = useCallback(async () => {
    const { data } = await client.from("radio_state").select("*").order("updated_at", { ascending: false }).limit(1);
    const row = data && data[0];
    if (row) { rowRef.current = { id: row.id, version: row.version }; setRs(row.state || null); }
  }, [client]);

  useEffect(() => {
    loadSeeds(); loadState();
    let ch = null;
    try {
      ch = client.channel("pp-radio")
        .on("postgres_changes", { event: "*", schema: "public", table: "radio_seeds" }, () => loadSeeds())
        .on("postgres_changes", { event: "*", schema: "public", table: "radio_state" }, (p) => {
          const row = p.new; if (row) { rowRef.current = { id: row.id, version: row.version }; setRs(row.state || null); }
        })
        .subscribe();
    } catch {}
    return () => { try { ch && client.removeChannel(ch); } catch {} };
  }, [client, loadSeeds, loadState]);

  // host writes the single shared now-playing row
  const writeState = useCallback(async (state) => {
    setRs(state);
    const row = rowRef.current;
    if (!row) {
      const { data } = await client.from("radio_state").insert({ state, version: 1 }).select().single();
      if (data) rowRef.current = { id: data.id, version: data.version };
      return;
    }
    const { data } = await client.from("radio_state").update({ state, version: row.version + 1, updated_at: new Date().toISOString() }).eq("id", row.id).select().single();
    if (data) rowRef.current = { id: data.id, version: data.version };
  }, [client]);

  // host: advance to the next track (builds/extends the station from the hat)
  const advance = useCallback(async () => {
    const h = host.current;
    if (!h.queue.length) {
      if (h.building) return; h.building = true;
      const pools = await Promise.all((seeds || []).map((s) => ytSearch(client, s.term + " song", 6)));
      const inter = []; const mx = Math.max(0, ...pools.map((p) => p.length));
      for (let i = 0; i < mx; i++) for (const p of pools) if (p[i]) inter.push(p[i]);
      const seen = new Set(); h.queue = [];
      for (const t of inter) if (t.videoId && !seen.has(t.videoId)) { seen.add(t.videoId); h.queue.push(t); }
      for (let i = h.queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [h.queue[i], h.queue[j]] = [h.queue[j], h.queue[i]]; }
      h.idx = -1; h.building = false;
      if (!h.queue.length) { flash("Add a song or artist to the hat first"); return; }
    }
    h.idx = (h.idx + 1) % h.queue.length;
    const t = h.queue[h.idx];
    writeState({ videoId: t.videoId, title: t.title, startedAt: Date.now(), playing: true });
  }, [client, seeds, writeState, flash]);
  const advanceRef = useRef(advance); useEffect(() => { advanceRef.current = advance; }, [advance]);

  // create the player once, inside an imperatively-added child so Preact never
  // reconciles (and clobbers) the YouTube iframe when the component re-renders.
  useEffect(() => {
    let dead = false;
    loadYT().then((YT) => {
      if (dead || !elRef.current || playerRef.current || !YT || !YT.Player) return;
      const inner = document.createElement("div");
      inner.style.width = "100%"; inner.style.height = "100%";
      elRef.current.appendChild(inner);
      playerRef.current = new YT.Player(inner, {
        width: "100%", height: "100%",
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 1 },
        events: {
          onReady: () => setReady(true),
          onStateChange: (e) => { if (e.data === YT.PlayerState.ENDED && isHost) advanceRef.current(); },
        },
      });
    });
    return () => { dead = true; try { playerRef.current && playerRef.current.destroy(); } catch {} playerRef.current = null; };
  }, []);

  // both phones: mirror the shared row onto the local player
  useEffect(() => {
    const p = playerRef.current;
    if (!ready || !p || !rs || !rs.videoId) return;
    try {
      const cur = p.getVideoData && p.getVideoData().video_id;
      const elapsed = rs.playing ? Math.max(0, (Date.now() - (rs.startedAt || Date.now())) / 1000) : (rs.pausedAt || 0);
      if (cur !== rs.videoId) {
        if (rs.playing) p.loadVideoById({ videoId: rs.videoId, startSeconds: elapsed });
        else p.cueVideoById({ videoId: rs.videoId, startSeconds: elapsed });
      } else if (rs.playing) {
        if (Math.abs((p.getCurrentTime() || 0) - elapsed) > 2.5) p.seekTo(elapsed, true);
        p.playVideo();
      } else { p.pauseVideo(); }
    } catch {}
  }, [ready, rs]);

  // gentle drift correction for the guest while playing
  useEffect(() => {
    if (isHost || !rs || !rs.playing) return;
    const id = setInterval(() => {
      const p = playerRef.current; if (!p || !rs.startedAt) return;
      try { const want = (Date.now() - rs.startedAt) / 1000; if (Math.abs((p.getCurrentTime() || 0) - want) > 2.5) p.seekTo(want, true); } catch {}
    }, 5000);
    return () => clearInterval(id);
  }, [isHost, rs && rs.videoId, rs && rs.playing, rs && rs.startedAt]);

  // ---- the hat ----
  const addSeed = async () => {
    const t = term.trim(); if (!t) return;
    setAdding(true); setTerm("");
    const hit = (await ytSearch(client, t, 1))[0] || {};
    const { error } = await client.from("radio_seeds").insert({ term: t, video_id: hit.videoId || null, title: hit.title || null, added_by: me.id });
    setAdding(false);
    if (error) { flash("⚠️ " + error.message); setTerm(t); return; }
    host.current.queue = [];   // fresh seed → rebuild the station next advance
    loadSeeds();
  };
  const removeSeed = async (s) => { await client.from("radio_seeds").delete().eq("id", s.id); host.current.queue = []; loadSeeds(); };

  // ---- host controls ----
  const playPause = () => {
    if (!isHost) { flash(`${partner ? partner.emoji : "Your partner"} is DJ — they drive playback`); return; }
    if (!rs || !rs.videoId) { advance(); return; }
    if (rs.playing) {
      const pausedAt = Math.max(0, (Date.now() - (rs.startedAt || Date.now())) / 1000);
      writeState({ ...rs, playing: false, pausedAt });
    } else {
      writeState({ ...rs, playing: true, startedAt: Date.now() - (rs.pausedAt || 0) * 1000 });
    }
  };
  const skip = () => { if (isHost) advance(); else flash("Your partner is DJ 🎧"); };

  const playing = !!(rs && rs.playing);
  return html`<div class="card jm listen" data-noswipe>
    <div class="jm-top"><button class="dd-back" onClick=${onBack}>‹ Join Me</button>
      <span class="jm-here sm">🟢 together</span></div>
    <h2>Listen together 🎧</h2>

    <div class="lt-stage">
      <div ref=${elRef} class="lt-player"></div>
      ${!(rs && rs.videoId) && html`<div class="lt-empty">${seeds.length ? "Press play to start your radio" : "Add a song or artist below to start"}</div>`}
    </div>
    <div class="lt-now">${rs && rs.title ? html`<span class="lt-eq ${playing ? "on" : ""}">♫</span> ${rs.title}` : html`<span class="muted">Your shared station</span>`}</div>
    <div class="lt-controls">
      <button class="btn ${playing ? "ghost" : ""}" onClick=${playPause}>${playing ? "⏸ Pause" : "▶ Play"}</button>
      <button class="btn ghost" onClick=${skip}>⏭ Skip</button>
    </div>
    ${!isHost && html`<div class="tiny muted center" style="margin-top:8px">${partner ? partner.emoji + " " + partner.name : "Your partner"} is the DJ — you're listening in sync</div>`}

    <div class="lt-hat">
      <div class="weyebrow">The hat — songs & artists for your radio</div>
      <div class="lt-add">
        <input value=${term} onInput=${(e) => setTerm(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter") addSeed(); }} placeholder="A song or artist…" />
        <button class="btn sm" disabled=${adding || !term.trim()} onClick=${addSeed}>${adding ? "…" : "＋ Add"}</button>
      </div>
      ${seeds.length === 0
        ? html`<div class="tiny muted" style="padding:6px 2px">Empty — add a few and the radio mixes them (and drifts into similar songs).</div>`
        : html`<div class="lt-seeds">${seeds.map((s) => html`<span class="lt-seed" key=${s.id}>
            <span class="lt-seed-t">${s.title || s.term}</span>
            <span class="lt-seed-x" role="button" onClick=${() => removeSeed(s)}>✕</span>
          </span>`)}</div>`}
    </div>
  </div>`;
}
