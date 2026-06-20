import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useCallback, useMemo, useRef } from "https://esm.sh/preact@10.23.2/hooks";
import { createPortal } from "https://esm.sh/preact@10.23.2/compat";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

/* 🙏 Gratitude — shared notes. Either partner jots what they're grateful for;
   both can read. The home card rotates ONE note per person per day (like the
   daily verse); tapping it opens a full-screen space to read them all and add
   more. */

const dayIndex = () => { const d = new Date(); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000); };
const fmtDay = (iso) => {
  try {
    const d = new Date(iso), t = new Date();
    if (d.toDateString() === t.toDateString()) return "today";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch { return ""; }
};

export function GratitudeCard({ client, me, players, flash }) {
  const [notes, setNotes] = useState([]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const taRef = useRef(null);

  const load = useCallback(async () => {
    const { data } = await client.from("gratitudes").select("*").order("created_at", { ascending: false });
    setNotes(data || []);
  }, [client]);

  useEffect(() => {
    load();
    let ch = null;
    try {
      ch = client.channel("pp-gratitude")
        .on("postgres_changes", { event: "*", schema: "public", table: "gratitudes" }, () => load())
        .subscribe();
    } catch {}
    return () => { try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load]);

  const pinfo = (id) => players.find((p) => p.id === id) || { name: "?", emoji: "❔" };

  // one note per person per day, rotating (deterministic from the date)
  const todays = useMemo(() => {
    const by = {};
    for (const g of notes) (by[g.created_by] || (by[g.created_by] = [])).push(g);
    const di = dayIndex();
    return players.map((p) => {
      const list = by[p.id]; if (!list || !list.length) return null;
      const asc = list.slice().reverse();                  // oldest→newest for stable rotation
      return { p, g: asc[di % asc.length] };
    }).filter(Boolean);
  }, [notes, players]);

  const add = async () => {
    const t = text.trim(); if (!t) return;
    setSaving(true);
    const { error } = await client.from("gratitudes").insert({ text: t, created_by: me.id });
    setSaving(false);
    if (error) { flash("⚠️ " + error.message); return; }
    setText(""); try { taRef.current && taRef.current.focus(); } catch {}
    load();
  };
  const del = async (g) => { await client.from("gratitudes").delete().eq("id", g.id); load(); };

  return html`<div class="card gratcard" role="button" onClick=${() => setOpen(true)}>
    <div class="eyebrow">Grateful <span class="muted-glyph">✨</span></div>
    ${todays.length === 0
      ? html`<p class="grat-empty">A little space to keep what you're thankful for. Tap to add the first.</p>`
      : todays.map(({ p, g }) => html`<div class="grat-line" key=${p.id}>
          <p class="grat-text">“${g.text}”</p>
          <div class="grat-by">— ${p.emoji} ${p.name}</div>
        </div>`)}
    <div class="grat-cta">Open gratitude ›</div>

    ${open && createPortal(html`<div class="gratfull" onClick=${(e) => e.stopPropagation()}>
      <div class="gratfull-bar">
        <button class="vw-x" onClick=${() => setOpen(false)}>✕</button>
        <span class="gratfull-title">Grateful 🙏</span>
        <span style="width:38px"></span>
      </div>
      <div class="gratfull-body">
        <div class="grat-compose">
          <textarea ref=${taRef} rows="3" value=${text} onInput=${(e) => setText(e.target.value)} placeholder="What are you grateful for today?" maxlength="500"></textarea>
          <button class="btn block" disabled=${saving || !text.trim()} onClick=${add}>${saving ? "Saving…" : "＋ Add gratitude"}</button>
        </div>
        ${notes.length === 0
          ? html`<div class="grat-blank">Nothing here yet — write the first thing you're grateful for. 🤍</div>`
          : html`<div class="grat-list">${notes.map((g) => {
              const mine = g.created_by === me.id; const a = pinfo(g.created_by);
              return html`<div class=${`grat-item ${mine ? "mine" : ""}`} key=${g.id}>
                <div class="grat-item-head"><span class="grat-item-who">${a.emoji} ${a.name}</span><span class="grat-item-date">${fmtDay(g.created_at)}</span></div>
                <p class="grat-item-text">${g.text}</p>
                ${mine && html`<button class="grat-item-del" onClick=${() => del(g)}>Remove</button>`}
              </div>`;
            })}</div>`}
      </div>
    </div>`, document.body)}
  </div>`;
}
