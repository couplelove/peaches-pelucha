import { h, render } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useMemo, useRef, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

/* 🍑🧸 Family page — a passcode-gated, READ-ONLY window into the couple's
   memories, for family to come see what they're up to. It ships no database
   key: it only POSTs a passcode to the `family-feed` Edge Function, which gates
   on a server-side secret and returns memories + their AI day-stories. No nav,
   no uploads, no edits — just the day-by-day story. */

const FEED = "https://ddaidwngxdbvfbchfixn.supabase.co/functions/v1/family-feed";
const PASS_KEY = "pp_family_pass";
const PAGE = 48;

const dayHead = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric", year: "numeric" });
};

async function fetchPage(passcode, offset) {
  const res = await fetch(FEED, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode, offset, limit: PAGE }),
  });
  if (res.status === 401) { const e = new Error("unauthorized"); e.unauthorized = true; throw e; }
  if (!res.ok) throw new Error("feed " + res.status);
  return res.json();
}

function App() {
  const [pass, setPass] = useState(() => localStorage.getItem(PASS_KEY) || "");
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(!!localStorage.getItem(PASS_KEY)); // true while we validate a saved pass
  const [gateErr, setGateErr] = useState("");
  const [draft, setDraft] = useState("");

  const [items, setItems] = useState([]);
  const [stories, setStories] = useState({});
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [openDay, setOpenDay] = useState(null);
  const [lightbox, setLightbox] = useState(null);   // index into flat items
  const sentinel = useRef(null);
  const inflight = useRef(false);

  const merge = (page) => {
    setItems((cur) => {
      const seen = new Set(cur.map((r) => r.id));
      return [...cur, ...page.items.filter((r) => !seen.has(r.id))];
    });
    setStories((cur) => ({ ...page.stories, ...cur }));
    setDone(!!page.done);
  };

  const loadMore = useCallback(async (passOverride) => {
    const pc = passOverride != null ? passOverride : pass;
    if (inflight.current || (done && !passOverride)) return;
    inflight.current = true; setLoading(true);
    try {
      const page = await fetchPage(pc, passOverride != null ? 0 : items.length);
      merge(page);
      setAuthed(true);
    } catch (e) {
      if (e.unauthorized) { setAuthed(false); localStorage.removeItem(PASS_KEY); if (passOverride != null) setGateErr("That passcode didn't work."); }
    } finally { inflight.current = false; setLoading(false); setChecking(false); }
  }, [pass, items.length, done]);

  // validate a saved passcode on first load
  useEffect(() => { if (pass) loadMore(pass); else setChecking(false); /* eslint-disable-next-line */ }, []);

  // infinite scroll
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !authed || openDay) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting && !done) loadMore(); }, { rootMargin: "700px" });
    io.observe(el);
    return () => io.disconnect();
  }, [authed, openDay, done, loadMore]);

  const submit = async (e) => {
    e.preventDefault();
    const pc = draft.trim();
    if (!pc) return;
    setGateErr(""); setPass(pc); localStorage.setItem(PASS_KEY, pc);
    setItems([]); setStories({}); setDone(false);
    await loadMore(pc);
  };

  const groups = useMemo(() => {
    const g = [];
    for (const it of items) {
      const last = g[g.length - 1];
      if (last && last.date === it.taken_on) last.items.push(it);
      else g.push({ date: it.taken_on, items: [it] });
    }
    return g;
  }, [items]);

  const flat = items;
  const openGroup = openDay ? groups.find((g) => g.date === openDay) : null;

  // ---- gate ----
  if (!authed) {
    if (checking) return html`<div class="fam-gate"><div class="heart">💗</div><div class="boot-text">…</div></div>`;
    return html`<div class="fam-gate">
      <div class="heart">💗</div>
      <h1>Peaches & Pelucha</h1>
      <p>Enter the family passcode to see our memories.</p>
      <form onSubmit=${submit}>
        <input type="password" autocomplete="off" autocapitalize="off" placeholder="passcode"
          value=${draft} onInput=${(e) => setDraft(e.target.value)} />
        <button class="btn" type="submit">Enter</button>
      </form>
      <p class="err">${gateErr}</p>
    </div>`;
  }

  // ---- one tile in a day's grid ----
  const cell = (it, i) => html`<button class="memcell" key=${it.id} onClick=${() => setLightbox(flat.indexOf(it))}>
    ${it.blur && html`<span class="memblur" style=${`background-image:url(${it.blur})`}></span>`}
    ${it.thumb && html`<img src=${it.thumb} loading="lazy" decoding="async" alt=""
      onLoad=${(e) => e.target.classList.add("ld")} ref=${(el) => { if (el && el.complete && el.naturalWidth) el.classList.add("ld"); }} />`}
    ${it.kind === "video" && html`<span class="memplay">🎥</span>`}
  </button>`;

  return html`<div class="fam-wrap">
    ${!openGroup && html`<div class="fam-mast">
      <div class="heart">🍑🧸</div>
      <h1>Our Memories</h1>
      <p>Peaches & Pelucha — what we've been up to</p>
    </div>`}
    <div class="fam-rule"></div>

    ${!openGroup && html`<div class="dayfeed">
      ${groups.map((g, gi) => {
        const s = stories[g.date];
        const cover = g.items.find((i) => i.kind === "photo") || g.items[0];
        const hero = cover.hero;
        const place = (g.items.find((i) => i.place) || {}).place;
        return html`<button class="daytile" key=${g.date} style=${cover.blur ? `background-image:url(${cover.blur})` : ""} onClick=${() => { setOpenDay(g.date); window.scrollTo(0, 0); }}>
          ${hero && html`<img class="dt-img" src=${hero} alt="" decoding="async" loading=${gi === 0 ? "eager" : "lazy"}
            onLoad=${(e) => e.target.classList.add("ld")} ref=${(el) => { if (el && el.complete && el.naturalWidth) el.classList.add("ld"); }} />`}
          <span class="dt-scrim"></span>
          <span class="dt-count">${g.items.length} 📸</span>
          <span class="dt-body">
            <span class="dt-date">${dayHead(g.date)}</span>
            <span class="dt-title">${(s && s.title) || place || "A day together"}</span>
            ${s && s.story && html`<span class="dt-story">${s.story}</span>`}
          </span>
        </button>`;
      })}
      <div ref=${sentinel} style="height:1px"></div>
      ${loading && html`<div class="fam-end"><span class="fam-spin"></span></div>`}
      ${done && groups.length > 0 && html`<div class="fam-end">🍑 · 🧸</div>`}
      ${done && groups.length === 0 && html`<div class="fam-end">No memories yet.</div>`}
    </div>`}

    ${openGroup && html`<div class="daydetail">
      <button class="dd-back" onClick=${() => setOpenDay(null)}>‹ All days</button>
      <div class="dd-head">
        <div class="dd-date">${dayHead(openGroup.date)}</div>
        <div class="dd-title">${(stories[openGroup.date] && stories[openGroup.date].title) || (openGroup.items.find((i) => i.place) || {}).place || "A day together"}</div>
        ${stories[openGroup.date] && stories[openGroup.date].story && html`<p class="dd-story">${stories[openGroup.date].story}</p>`}
      </div>
      <div class="memgrid">${openGroup.items.map(cell)}</div>
    </div>`}

    ${lightbox !== null && flat[lightbox] && html`<${Lightbox} items=${flat} index=${lightbox}
      onClose=${() => setLightbox(null)} onNav=${(i) => setLightbox(i)} />`}
  </div>`;
}

function Lightbox({ items, index, onClose, onNav }) {
  const it = items[index];
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index + 1 < items.length) onNav(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onNav(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length]);

  // basic swipe between items / swipe-down to close
  const drag = useRef(null);
  const down = (e) => { if (e.target.tagName === "VIDEO") return; drag.current = { x: e.clientX, y: e.clientY }; };
  const up = (e) => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0 && index + 1 < items.length) onNav(index + 1);
      else if (dx > 0 && index > 0) onNav(index - 1);
    } else if (dy > 90) onClose();
  };

  if (!it) return null;
  return html`<div class="fam-lb" onPointerDown=${down} onPointerUp=${up}
    onClick=${(e) => { if (e.target.classList.contains("fam-lb")) onClose(); }}>
    <button class="fam-lb-x" onClick=${onClose}>✕</button>
    <button class="fam-lb-nav prev" disabled=${index === 0} onClick=${() => onNav(index - 1)}>‹</button>
    <div class="fam-lb-media">
      ${it.kind === "video"
        ? html`<video src=${it.full} controls playsinline autoplay></video>`
        : html`<img src=${it.full} alt="" />`}
    </div>
    <button class="fam-lb-nav next" disabled=${index === items.length - 1} onClick=${() => onNav(index + 1)}>›</button>
    <div class="fam-lb-meta">${dayHead(it.taken_on)}${it.place ? " · 📍 " + it.place : ""} · ${index + 1} / ${items.length}</div>
  </div>`;
}

render(html`<${App} />`, document.getElementById("fam"));
