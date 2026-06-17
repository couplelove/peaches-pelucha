import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useRef, useMemo } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { notifyTurn } from "./push.js";

const html = htm.bind(h);

/* 🧘 Join Me — a real-time space you can only use when you're BOTH in the app.
   Presence (Supabase realtime) gates it; the first feature is a synchronized
   breathe-together session. The breathing + countdown are derived purely from a
   shared `startedAt` timestamp, so both phones stay in lockstep with no constant
   messaging — just one broadcast to start/stop (and a presence copy so a late
   re-join recovers an in-progress session). */

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

export function JoinMe({ client, me, players, flash }) {
  const demo = !!client._db;
  const partner = players.find((p) => p.id !== me.id) || null;
  const [here, setHere] = useState({});
  const [session, setSession] = useState(null);   // { startedAt, durationSec }
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
      if (peerSession) setSession((cur) => cur || peerSession);   // adopt an in-progress session on (re)join
    })
      .on("broadcast", { event: "jm" }, ({ payload }) => {
        if (!payload) return;
        if (payload.kind === "start") setSession({ startedAt: payload.startedAt, durationSec: payload.durationSec });
        else if (payload.kind === "stop") setSession(null);
      })
      .subscribe(async (s) => { if (s === "SUBSCRIBED" && ch.track) { try { await ch.track(meInfo); } catch {} } });
    return () => { chRef.current = null; try { client.removeChannel(ch); } catch {} };
  }, [client, me.id, demo]);

  // tick only while a session runs (drives the label / countdown / prompt)
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [session]);

  const partnerHere = demo ? true : !!(partner && here[partner.id]);

  const track = (extra) => { const ch = chRef.current; if (ch && ch.track) ch.track({ ...meInfo, ...extra }).catch(() => {}); };
  const send = (payload) => { const ch = chRef.current; if (ch && ch.send) ch.send({ type: "broadcast", event: "jm", payload }); };
  const start = (min) => { const s = { startedAt: Date.now(), durationSec: min * 60 }; setSession(s); send({ kind: "start", ...s }); track({ session: s }); };
  const end = () => { setSession(null); send({ kind: "stop" }); track({ session: null }); };
  const nudge = () => { if (partner && !demo) { notifyTurn(client, partner.id, "Join Me 🧘", `${me.name} wants a moment together`); flash(`Nudged ${partner.name} 🧘`); } };

  // breathing animation-delay computed once per session, so tick re-renders never restart the CSS animation
  const breathDelay = useMemo(() => session ? -(((Date.now() - session.startedAt) / 1000) % CYCLE) : 0, [session && session.startedAt]);

  // ---------- active session ----------
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

  // ---------- lobby ----------
  return html`<div class="card jm">
    <div class="eyebrow">Join Me 🧘</div>
    ${partnerHere ? html`
      <h2>Breathe together</h2>
      <p class="jm-lede">A quiet moment with ${partner ? partner.name : "your love"}, from anywhere. Pick a length — you’ll both drop in together.</p>
      <div class="jm-presets">
        ${PRESETS.map((m) => html`<button class="jm-preset tap" key=${m} onClick=${() => start(m)}>${m} min</button>`)}
      </div>
      <div class="jm-here">🟢 You’re both here</div>
    ` : html`
      <h2>A moment, together</h2>
      <p class="jm-lede">Join Me lights up when you’re both in the app at the same time. ${partner ? partner.name : "Your partner"} isn’t here right now.</p>
      <div class="jm-waiting"><span class="jm-wait-pulse"></span><span class="jm-wait-av">${partner ? partner.emoji : "🫂"}</span></div>
      ${partner && !demo ? html`<button class="btn block" onClick=${nudge}>🧘 Invite ${partner.name} to breathe</button>` : ""}
    `}
  </div>`;
}
