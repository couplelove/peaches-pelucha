import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { createPortal } from "https://esm.sh/preact@10.23.2/compat";
import htm from "https://esm.sh/htm@3.1.1";
import { notifyTurn } from "./push.js";

const html = htm.bind(h);

/* ☀️ The morning ritual. Once a day, before either of you can use the app, you
   each answer one silly little question — usually about growing up — and the
   app stays gated until you BOTH have. Then it reveals both answers, so the day
   together always starts with a small share. Editorial + warm, like Fight Mode
   but gentle. One row per day in `daily_shares`; the first to open seeds the
   question (deterministic by date, so you both get the same one). */

const QUESTIONS = [
  "What cartoon did you race home from school to watch?",
  "What did you want to be when you grew up — at age seven?",
  "What's a smell that drops you straight back into childhood?",
  "What was your most regrettable childhood haircut?",
  "What snack or candy was your whole personality as a kid?",
  "What song did you know every single word to growing up?",
  "What toy did you BEG your parents for?",
  "What's a weird thing you fully believed as a kid?",
  "What was your nickname growing up?",
  "What show or movie did you watch on repeat?",
  "What game did everyone play at recess?",
  "What's the bravest thing little-you ever did?",
  "What chore did you hate the most?",
  "What did your childhood bedroom look like?",
  "Who was your first ever celebrity crush?",
  "What family meal did your house make that nobody else's did?",
  "What was the best birthday party you ever had?",
  "What were you weirdly good at as a kid?",
  "What's a fear you had as a child that's a little silly now?",
  "Where was your favorite hiding spot growing up?",
  "What's a phrase a grandparent always used to say?",
  "What's the first concert or movie you remember going to?",
  "What did you want to name your future kids when you were little?",
  "What trouble did you get into the most as a kid?",
  "What was your comfort show when you were home sick?",
  "What's a tradition your family did that you still love?",
  "What's the dorkiest hobby you had as a kid?",
  "What was your dream pet growing up?",
  "What did you spend your allowance on?",
  "What's a tiny thing that made little-you the happiest?",
  "What did you think being a grown-up would be like?",
  "What's a vacation from childhood you still daydream about?",
];

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayIndex = (s) => Math.floor(new Date(s + "T00:00:00").getTime() / 864e5);
const pickQuestion = (day) => QUESTIONS[(((dayIndex(day) % QUESTIONS.length) + QUESTIONS.length) % QUESTIONS.length)];
const niceDate = (s) => { try { return new Date(s + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }); } catch { return ""; } };

export function DailyShare({ client, me, players }) {
  const day = todayStr();
  const [row, setRow] = useState(undefined);      // undefined = loading, null = unavailable (fail open)
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState(() => { try { return localStorage.getItem("pp.daily." + day) === "1"; } catch { return false; } });
  const partner = players.find((p) => p.id !== me.id) || null;

  const load = useCallback(async () => {
    try {
      const { data } = await client.from("daily_shares").select("*").eq("day", day).limit(1);
      let r = data && data[0];
      if (!r) {
        const ins = await client.from("daily_shares").insert({ day, question: pickQuestion(day), answers: {} }).select().single();
        if (ins.data) r = ins.data;
        else { const re = await client.from("daily_shares").select("*").eq("day", day).limit(1); r = re.data && re.data[0]; }   // someone else just seeded it
      }
      setRow(r || null);
    } catch { setRow(null); }     // fail open — never lock people out on an error
  }, [client, day]);

  useEffect(() => {
    load();
    let ch = null;
    try { ch = client.channel("pp-daily").on("postgres_changes", { event: "*", schema: "public", table: "daily_shares" }, () => load()).subscribe(); } catch {}
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => { document.removeEventListener("visibilitychange", wake); window.removeEventListener("focus", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load]);

  const answers = (row && row.answers) || {};
  const mine = answers[me.id];
  const both = players.length >= 2 && players.every((p) => answers[p.id]);

  const submit = async () => {
    const t = draft.trim();
    if (!t || !row) return;
    setBusy(true);
    for (let i = 0; i < 4; i++) {       // version-guarded merge (both phones may write at once)
      const { data: cur } = await client.from("daily_shares").select("*").eq("id", row.id).single();
      if (!cur) break;
      const next = { ...(cur.answers || {}), [me.id]: t };
      const { data: upd } = await client.from("daily_shares").update({ answers: next, version: cur.version + 1 }).eq("id", cur.id).eq("version", cur.version).select();
      if (upd && upd.length) { setRow(upd[0]); break; }
      await new Promise((r) => setTimeout(r, 160));
    }
    setBusy(false);
    if (partner && !answers[partner.id]) { try { notifyTurn(client, partner.id, "☀️ Today's little question", `${me.emoji} ${me.name} shared — it's your turn before you start the day`); } catch {} }
  };

  const startDay = () => { try { localStorage.setItem("pp.daily." + day, "1"); } catch {} setSeen(true); };

  if (row === undefined || row === null) return null;    // loading or unavailable → don't gate
  if (both && seen) return null;                         // done & acknowledged for today

  const pinfo = (id) => players.find((p) => p.id === id) || { emoji: "❔", name: "?" };

  let body;
  if (!mine) {
    body = html`<div class="daily-step">
      <div class="daily-q">${row.question}</div>
      <textarea class="daily-input" rows="3" autofocus value=${draft} maxlength="280"
        onInput=${(e) => setDraft(e.target.value)} placeholder="say the first thing that comes to mind…"></textarea>
      <button class="btn block daily-btn" disabled=${busy || !draft.trim()} onClick=${submit}>${busy ? "Sharing…" : "Share ☀️"}</button>
    </div>`;
  } else if (!both) {
    body = html`<div class="daily-wait">
      <div class="daily-q small">${row.question}</div>
      <div class="daily-yours"><span class="daily-tag">you said</span>${mine}</div>
      <div class="daily-waiting">🤍 Waiting for ${partner ? partner.emoji + " " + partner.name : "your partner"}…<br/><span class="tiny">the app opens once you've both shared</span></div>
    </div>`;
  } else {
    body = html`<div class="daily-reveal">
      <div class="daily-q small">${row.question}</div>
      <div class="daily-cards">
        ${players.map((p) => html`<div class=${`daily-card ${p.id === me.id ? "mine" : ""}`} key=${p.id}>
          <div class="daily-who">${p.emoji} ${p.name}</div>
          <div class="daily-ans">${answers[p.id]}</div>
        </div>`)}
      </div>
      <button class="btn block daily-btn" onClick=${startDay}>Start the day together →</button>
    </div>`;
  }

  return createPortal(html`<div class="dailyfull lock">
    <div class="daily-inner">
      <div class="daily-eyebrow">${both ? "what you both shared" : "before today begins"} · ${niceDate(day)}</div>
      <div class="daily-sun">☀️</div>
      ${body}
    </div>
  </div>`, document.body);
}

/* A small home card with the latest answered question → tap for the full log. */
export function DailyHistory({ client, me, players }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data } = await client.from("daily_shares").select("day,question,answers").order("day", { ascending: false }).limit(180);
      setRows((data || []).filter((r) => players.length >= 2 && players.every((p) => r.answers && r.answers[p.id])));   // only days you BOTH answered
    } catch { setRows([]); }
  }, [client, players]);
  useEffect(() => {
    load();
    let ch = null;
    try { ch = client.channel("pp-dailyhist").on("postgres_changes", { event: "*", schema: "public", table: "daily_shares" }, () => load()).subscribe(); } catch {}
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    return () => { document.removeEventListener("visibilitychange", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load]);

  if (!rows || !rows.length) return null;    // nothing answered together yet → no clutter
  const latest = rows[0];

  return html`<div class="card dailyhist" onClick=${() => setOpen(true)}>
    <div class="shead"><h2>Daily questions <span class="muted-glyph">☀️</span></h2><span class="linkbtn micro">${rows.length} →</span></div>
    <div class="dh-q">${latest.question}</div>
    <div class="dh-peek">${players.map((p) => html`<span class="dh-peek-a" key=${p.id}>${p.emoji} ${latest.answers[p.id]}</span>`)}</div>

    ${open && createPortal(html`<div class="dh-full" onClick=${(e) => { if (e.target.classList.contains("dh-full")) setOpen(false); }}>
      <div class="dh-bar">
        <span class="dh-title">Daily questions ☀️</span>
        <button class="dh-x" onClick=${() => setOpen(false)}>✕</button>
      </div>
      <div class="dh-list">
        ${rows.map((r) => html`<div class="dh-entry" key=${r.day}>
          <div class="dh-date">${niceDate(r.day)}</div>
          <div class="dh-eq">${r.question}</div>
          ${players.map((p) => html`<div class="dh-ans" key=${p.id}>
            <span class="dh-ans-who">${p.emoji} ${p.name}</span>
            <span class="dh-ans-txt">${r.answers[p.id]}</span>
          </div>`)}
        </div>`)}
      </div>
    </div>`, document.body)}
  </div>`;
}
