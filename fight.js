import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useRef, useMemo, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { createPortal } from "https://esm.sh/preact@10.23.2/compat";
import htm from "https://esm.sh/htm@3.1.1";
import { notifyTurn } from "./push.js";

const html = htm.bind(h);

/* 🕊️ Fight Mode — an opt-in, AI-mediated "mend" that TAKES OVER the app.
   Turn it on in settings. When you're fighting, start a mend and the whole app
   locks behind a full-screen flow until you BOTH come together: you each
   privately vent + answer a few questions; once you've both shared, Claude
   translates each of you to the other (what to HEAR + what to FOCUS on, never
   taking sides); you both tap "I hear you" and it releases. A timer counts the
   time you're spending apart, to nudge you back together fast. */

const clock = (s) => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(ss).padStart(2, "0");
};

function useFightSetting(client) {
  const [on, setOn] = useState(false);
  const load = useCallback(async () => {
    try { const { data } = await client.from("app_settings").select("value").eq("key", "fight_mode").limit(1);
      setOn(!!(data && data[0] && data[0].value && data[0].value.on)); } catch {}
  }, [client]);
  useEffect(() => {
    load();
    let ch = null;
    try { ch = client.channel("pp-settings").on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, () => load()).subscribe(); } catch {}
    return () => { try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load]);
  const set = useCallback(async (val) => {
    setOn(val);
    try {
      const { data } = await client.from("app_settings").select("key").eq("key", "fight_mode").limit(1);
      if (data && data.length) await client.from("app_settings").update({ value: { on: val }, updated_at: new Date().toISOString() }).eq("key", "fight_mode");
      else await client.from("app_settings").insert({ key: "fight_mode", value: { on: val } });
    } catch {}
  }, [client]);
  return [on, set];
}

function useActiveFight(client) {
  const [fight, setFight] = useState(null);
  const load = useCallback(async () => {
    try {
      const { data } = await client.from("fights").select("*").in("status", ["venting", "revealed"]).order("created_at", { ascending: false }).limit(1);
      setFight((data && data[0]) || null);
    } catch {}
  }, [client]);
  useEffect(() => {
    load();
    let ch = null;
    try { ch = client.channel("pp-fights").on("postgres_changes", { event: "*", schema: "public", table: "fights" }, () => load()).subscribe(); } catch {}
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => { document.removeEventListener("visibilitychange", wake); window.removeEventListener("focus", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load]);
  return [fight, setFight, load];
}

/* ---- settings: toggle + start a mend ---- */
export function FightToggle({ client, me, players }) {
  const [on, setOn] = useFightSetting(client);
  const [fight] = useActiveFight(client);
  const partner = players.find((p) => p.id !== me.id) || null;
  const start = async () => {
    if (fight) return;
    const { data } = await client.from("fights").insert({ status: "venting", started_by: me.id, entries: {}, translations: {}, acks: {} }).select().single();
    if (data && partner) { try { notifyTurn(client, partner.id, "🕊️ Let's mend", `${me.name} started Fight Mode — the app is paused until you come back together.`); } catch {} }
  };
  return html`<div class="card">
    <div class="shead"><h2>Fight Mode <span class="muted-glyph">🕊️</span></h2>
      <label class="switch"><input type="checkbox" checked=${on} onChange=${(e) => setOn(e.target.checked)} /><span class="switch-track"></span></label>
    </div>
    <p class="sub" style="margin-top:-4px">When you're in a rough spot, start a mend — the app pauses for both of you until you've heard each other and come back together. A timer counts the time apart.</p>
    ${on && html`<button class="btn block" disabled=${!!fight} onClick=${start}>${fight ? "A mend is in progress…" : "🕊️ Start a mend"}</button>`}
  </div>`;
}

/* ---- the takeover: locks the app until both come together ---- */
export function FightMode({ client, me, players }) {
  const [fight, setFight, reload] = useActiveFight(client);
  const partner = players.find((p) => p.id !== me.id) || null;
  const ordered = useMemo(() => players.slice().sort((a, b) => (a.id < b.id ? -1 : 1)), [players]);
  const isHost = ordered[0] && me.id === ordered[0].id;
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({ happened: "", feeling: "", need: "", love: "" });
  const [nowT, setNowT] = useState(Date.now());
  const triggered = useRef(false);
  const startedAtRef = useRef(null);

  useEffect(() => { if (!fight || fight.status !== "venting") triggered.current = false; }, [fight && fight.id, fight && fight.status]);
  // remember when this fight began (for the closing screen, after the row drops)
  useEffect(() => { if (fight) startedAtRef.current = fight.created_at; }, [fight && fight.id]);
  // catch the partner finishing last
  const prevStatus = useRef(null);
  useEffect(() => { if (prevStatus.current === "revealed" && !fight) setDone(true); prevStatus.current = fight && fight.status; }, [fight]);
  // tick the timer while a mend is active
  useEffect(() => {
    if (!fight && !done) return;
    const id = setInterval(() => setNowT(Date.now()), 1000);
    return () => clearInterval(id);
  }, [!!fight, done]);

  const update = useCallback(async (id, mut) => {
    for (let i = 0; i < 4; i++) {
      const { data: row } = await client.from("fights").select("*").eq("id", id).single();
      if (!row) return null;
      const patch = mut(row);
      if (!patch) return row;
      const { data: upd } = await client.from("fights").update({ ...patch, version: row.version + 1 }).eq("id", row.id).eq("version", row.version).select();
      if (upd && upd.length) { setFight(upd[0]); return upd[0]; }
      await new Promise((r) => setTimeout(r, 180));
    }
    reload();
  }, [client, setFight, reload]);

  const mine = fight && fight.entries && fight.entries[me.id];
  const submitEntry = async () => {
    if (!fight) return;
    const e = { happened: form.happened.trim(), feeling: form.feeling.trim(), need: form.need.trim(), love: form.love.trim() };
    if (!e.happened && !e.feeling && !e.need) return;
    setBusy(true);
    await update(fight.id, (row) => ({ entries: { ...(row.entries || {}), [me.id]: e } }));
    setBusy(false);
  };

  useEffect(() => {
    if (!fight || fight.status !== "venting" || !isHost || triggered.current) return;
    const both = ordered.every((p) => fight.entries && fight.entries[p.id]);
    if (!both) return;
    triggered.current = true;
    (async () => {
      try {
        const { data } = await client.functions.invoke("mend", { body: { people: ordered.map((p) => ({ name: p.name })), entries: ordered.map((p) => fight.entries[p.id]) } });
        if (!data || !data.a || !data.b) { triggered.current = false; return; }
        const translations = { [ordered[0].id]: data.a, [ordered[1].id]: data.b };
        await update(fight.id, (row) => row.status !== "venting" ? null : ({ translations, together: data.together || null, status: "revealed" }));
      } catch { triggered.current = false; }
    })();
  }, [fight && fight.id, fight && fight.status, fight && JSON.stringify(fight.entries || {}), isHost]);

  const ack = async () => {
    if (!fight) return;
    setBusy(true);
    const res = await update(fight.id, (row) => {
      const acks = { ...(row.acks || {}), [me.id]: true };
      const both = players.every((p) => acks[p.id]);
      return both ? { acks, status: "resolved", resolved_at: new Date().toISOString() } : { acks };
    });
    setBusy(false);
    if (res && res.status === "resolved") setDone(true);
  };

  // safety valve: never permanently brick the app. Quiet, confirm-gated, ends for both.
  const endMend = async () => {
    if (!fight) return;
    if (!confirm("End the mend for both of you without finishing? Try to come back together instead 💗")) return;
    await client.from("fights").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", fight.id);
    setFight(null);
  };

  if (!fight && !done) return null;   // app is normal when there's no active mend

  const elapsed = (nowT - new Date((fight && fight.created_at) || startedAtRef.current || Date.now()).getTime()) / 1000;
  let body;
  if (done) {
    body = html`<div class="fight-intro">
      <div class="fight-bigmark">💗</div>
      <h2>You found your way back.</h2>
      <p class="fight-lede">You both showed up and listened. That's the whole thing. Sit close for a minute — or breathe together in Join Me.</p>
      <button class="btn block" onClick=${() => setDone(false)}>We're good</button>
    </div>`;
  } else if (fight.status === "venting") {
    body = !mine ? html`<div class="fight-step">
      <div class="fight-eyebrow">Your side — just for the two of you</div>
      <${Q} label="What happened, from your side?" v=${form.happened} set=${(x) => setForm({ ...form, happened: x })} ph="Say it however it comes out…" />
      <${Q} label="How are you feeling right now?" v=${form.feeling} set=${(x) => setForm({ ...form, feeling: x })} ph="Hurt, tired, unseen, angry…" />
      <${Q} label="What do you need?" v=${form.need} set=${(x) => setForm({ ...form, need: x })} ph="What would help you feel okay again?" />
      <${Q} label="One thing you still love about them (optional)" v=${form.love} set=${(x) => setForm({ ...form, love: x })} ph="Even now…" />
      <button class="btn block mt" disabled=${busy || !(form.happened.trim() || form.feeling.trim() || form.need.trim())} onClick=${submitEntry}>${busy ? "Sharing…" : "Share with the mediator"}</button>
    </div>` : html`<div class="fight-wait">
      <div class="fight-bigmark">🤍</div>
      <h2>Thank you for sharing.</h2>
      <p class="fight-lede">${ordered.every((p) => fight.entries[p.id]) ? "Reading you both, gently…" : `Waiting for ${partner ? partner.emoji + " " + partner.name : "your partner"} to share their side. The app stays paused until you're both ready.`}</p>
    </div>`;
  } else if (fight.status === "revealed") {
    const t = (fight.translations && fight.translations[me.id]) || { hear: "", focus: "" };
    const acked = fight.acks && fight.acks[me.id];
    body = html`<div class="fight-reveal">
      <div class="fight-eyebrow">What ${partner ? partner.name : "they"} needs you to hear</div>
      <p class="fight-hear">${t.hear}</p>
      <div class="fight-eyebrow">Focus on this</div>
      <p class="fight-focus">${t.focus}</p>
      ${fight.together && html`<p class="fight-together">${fight.together}</p>`}
      ${acked
        ? html`<div class="fight-acked">💗 You said you hear them. ${ordered.every((p) => fight.acks && fight.acks[p.id]) ? "" : `Waiting for ${partner ? partner.name : "your partner"} to come together…`}</div>`
        : html`<button class="btn block mt" onClick=${ack} disabled=${busy}>💗 I hear you</button>`}
    </div>`;
  }

  return createPortal(html`<div class="fightfull lock">
    <div class="fightfull-bar">
      <span class="fightfull-title">Mend 🕊️</span>
      ${!done && html`<span class="fight-timer" title="Time you're spending apart">⏱ ${clock(elapsed)} apart</span>`}
    </div>
    <div class="fightfull-body">${body}</div>
    ${!done && fight && html`<button class="fight-end" onClick=${endMend}>Step away (ends the mend for both)</button>`}
  </div>`, document.body);
}

function Q({ label, v, set, ph }) {
  return html`<label class="fight-q">
    <span class="fight-q-l">${label}</span>
    <textarea rows="2" value=${v} onInput=${(e) => set(e.target.value)} placeholder=${ph} maxlength="600"></textarea>
  </label>`;
}
