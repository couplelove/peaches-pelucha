import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useCallback, useRef, useMemo } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

/* 📸 Memories — a shared photo & video gallery (Supabase Storage) and a
   memory-match game: flip cards to find two photos taken on the SAME DAY. */

const dayHead = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric", year: "numeric" });
};

// client-side photo downscale → fast uploads, consistent quality.
// Two decode paths: createImageBitmap (fast) falling back to an <img> decode
// (handles iPhone HEIC on Safari, where createImageBitmap can refuse).
async function decodeImage(file) {
  try { return await createImageBitmap(file); } catch {}
  return await new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("undecodable image")); };
    img.src = url;
  });
}
async function shrinkPhoto(file) {
  const src = await decodeImage(file);            // throws if truly undecodable
  const w0 = src.naturalWidth || src.width, h0 = src.naturalHeight || src.height;
  const scale = Math.min(1, 1600 / Math.max(w0, h0));
  const w = Math.round(w0 * scale), hh = Math.round(h0 * scale);
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = hh;
  cv.getContext("2d").drawImage(src, 0, 0, w, hh);
  if (src.close) try { src.close(); } catch {}
  if (src.src) try { URL.revokeObjectURL(src.src); } catch {}
  const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.82));
  if (!blob) throw new Error("couldn’t encode image");
  return blob;
}

// upload with retries — mobile networks drop large bodies routinely
async function uploadWithRetry(client, path, blob, contentType) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await client.storage.from("memories")
      .upload(path, blob, { contentType, cacheControl: "31536000", upsert: true });
    if (!error) return;
    lastErr = error;
    await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
  }
  throw lastErr || new Error("upload failed");
}

export function MemoriesTab({ client, me, flash }) {
  const [items, setItems] = useState(null);          // null = loading
  const [view, setView] = useState("gallery");       // 'gallery' | 'game'
  const [lightbox, setLightbox] = useState(null);    // index into items
  const [uploads, setUploads] = useState(null);      // {done, total} | null
  const fileInput = useRef(null);

  const pubUrl = useCallback((path) => {
    try { return client.storage.from("memories").getPublicUrl(path).data.publicUrl; }
    catch { return ""; }
  }, [client]);

  const load = useCallback(async () => {
    const { data, error } = await client.from("memories").select("*")
      .order("taken_on", { ascending: false }).order("created_at", { ascending: false });
    if (!error) setItems(data || []);
    else setItems([]);
  }, [client]);

  useEffect(() => {
    load();
    let ch = null;
    try {
      ch = client.channel("pp-memories")
        .on("postgres_changes", { event: "*", schema: "public", table: "memories" }, () => load())
        .subscribe();
    } catch {}
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    return () => { document.removeEventListener("visibilitychange", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load]);

  // Concurrent upload queue (3 lanes) with per-file status — photos shrink
  // on-device first; videos go as-is (50MB storage cap surfaced honestly).
  const onPick = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    const jobs = files.map((f, i) => ({ i, f, status: "queued" }));
    const paint = () => setUploads({ done: jobs.filter((j) => j.status === "done" || j.status === "failed").length, total: jobs.length, failed: jobs.filter((j) => j.status === "failed").length });
    paint();
    const runJob = async (j) => {
      const f = j.f;
      try {
        const isVideo = f.type.startsWith("video/");
        if (isVideo && f.size > 49 * 1024 * 1024) throw new Error("video over 50MB — trim it first");
        j.status = "working"; paint();
        let blob, ext, ct;
        if (isVideo) { blob = f; ext = f.name.toLowerCase().endsWith(".mov") ? "mov" : "mp4"; ct = f.type || "video/mp4"; }
        else { blob = await shrinkPhoto(f); ext = "jpg"; ct = "image/jpeg"; }
        const path = `u${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        await uploadWithRetry(client, path, blob, ct);
        const taken = new Date(f.lastModified || Date.now());
        const taken_on = `${taken.getFullYear()}-${String(taken.getMonth() + 1).padStart(2, "0")}-${String(taken.getDate()).padStart(2, "0")}`;
        const { error: rowErr } = await client.from("memories")
          .insert({ path, kind: isVideo ? "video" : "photo", taken_on, uploaded_by: me.id });
        if (rowErr) throw rowErr;
        j.status = "done";
      } catch (err) {
        j.status = "failed"; j.err = err.message || "failed";
      }
      paint();
    };
    const lanes = Array.from({ length: 3 }, async () => {
      for (;;) {
        const j = jobs.find((x) => x.status === "queued");
        if (!j) return;
        j.status = "working";
        await runJob(j);
      }
    });
    await Promise.all(lanes);
    const ok = jobs.filter((j) => j.status === "done").length;
    const failed = jobs.filter((j) => j.status === "failed");
    setUploads(null);
    if (ok) load();
    if (failed.length) flash(`⚠️ ${failed.length} failed (${failed[0].err})${ok ? ` · ${ok} added` : ""}`);
    else if (ok) flash(`Added ${ok} ${ok === 1 ? "memory" : "memories"} 📸`);
  };

  // tap & hold a memory → options (save / delete)
  const [sheet, setSheet] = useState(null);          // a memory item
  const press = useRef(null);
  const holdStart = (it) => (e) => {
    press.current = { t: setTimeout(() => { press.current = { fired: true }; try { navigator.vibrate && navigator.vibrate(30); } catch {} setSheet(it); }, 480), fired: false };
  };
  const holdEnd = (it) => () => {
    const p = press.current;
    if (p && p.t) clearTimeout(p.t);
    const fired = p && p.fired;
    press.current = null;
    if (!fired) setLightbox(flat.indexOf(it));       // normal tap → lightbox
  };
  const holdCancel = () => { const p = press.current; if (p && p.t) clearTimeout(p.t); press.current = null; };

  const saveItem = async (it) => {
    try {
      const res = await fetch(pubUrl(it.path));
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = it.path;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      flash("Saving 📥");
    } catch { flash("⚠️ couldn’t fetch the file"); }
    setSheet(null);
  };
  const deleteItem = async (it) => {
    if (!confirm("Delete this memory for both of you?")) return;
    try {
      await client.storage.from("memories").remove([it.path]);
      await client.from("memories").delete().eq("id", it.id);
      flash("Deleted");
      setSheet(null);
      load();
    } catch (err) { flash("⚠️ " + (err.message || "delete failed")); }
  };

  // group by day for the gallery
  const groups = useMemo(() => {
    const g = [];
    for (const it of items || []) {
      const last = g[g.length - 1];
      if (last && last.date === it.taken_on) last.items.push(it);
      else g.push({ date: it.taken_on, items: [it] });
    }
    return g;
  }, [items]);

  const flat = items || [];

  return html`<div>
    <div class="card">
      <div class="shead">
        <h2>Memories</h2>
        <div class="shead-actions">
          <div class="seg" style="padding:3px">
            <button class=${view === "gallery" ? "on" : ""} onClick=${() => setView("gallery")}>Gallery</button>
            <button class=${view === "game" ? "on" : ""} onClick=${() => setView("game")}>Match</button>
          </div>
          <button class="btn sm" disabled=${!!uploads} onClick=${() => fileInput.current && fileInput.current.click()}>
            ${uploads ? `${uploads.done}/${uploads.total}…` : "＋ Add"}
          </button>
        </div>
      </div>
      <input ref=${fileInput} type="file" accept="image/*,video/*" multiple style="display:none" onChange=${onPick} />

      ${uploads && html`<div class="upbar"><div class="upbar-fill" style=${`width:${Math.round((uploads.done / uploads.total) * 100)}%`}></div></div>`}
      ${uploads && html`<div class="tiny muted" style="margin:-6px 0 10px">uploading ${uploads.done}/${uploads.total}${uploads.failed ? ` · ${uploads.failed} failed` : ""}</div>`}

      ${items === null && html`<div class="memskel">${[...Array(9)].map((_, i) => html`<div class="memskel-cell" key=${i}></div>`)}</div>`}
      ${items !== null && items.length === 0 && html`<div class="empty"><span class="big">📸</span>No memories yet — add your first.</div>`}

      ${view === "gallery" && groups.map((g) => html`<div key=${g.date}>
        <div class="memday">${dayHead(g.date)}</div>
        <div class="memgrid">
          ${g.items.map((it) => html`<button class="memcell" key=${it.id}
            onPointerDown=${holdStart(it)} onPointerUp=${holdEnd(it)}
            onPointerMove=${holdCancel} onPointerCancel=${holdCancel}
            onContextMenu=${(e) => e.preventDefault()}>
            ${it.kind === "video"
              ? html`<video src=${pubUrl(it.path) + "#t=0.1"} preload="metadata" muted playsinline></video><span class="memplay">▶</span>`
              : html`<img src=${pubUrl(it.path)} loading="lazy" alt="" />`}
          </button>`)}
        </div>
      </div>`)}

      ${view === "game" && items !== null && html`<${MatchGame} items=${items} pubUrl=${pubUrl} />`}
    </div>

    ${lightbox !== null && html`<${Lightbox} items=${flat} index=${lightbox} pubUrl=${pubUrl}
      onClose=${() => setLightbox(null)} onNav=${(i) => setLightbox(i)} onOptions=${(it) => setSheet(it)} />`}

    ${sheet && html`<div class="modal-bg asheet" onClick=${(e) => { if (e.target.classList.contains("modal-bg")) setSheet(null); }}>
      <div class="modal">
        <div class="handle"></div>
        <div class="asheet-preview">
          ${sheet.kind === "video"
            ? html`<video src=${pubUrl(sheet.path) + "#t=0.1"} preload="metadata" muted playsinline></video>`
            : html`<img src=${pubUrl(sheet.path)} alt="" />`}
          <div class="tiny muted" style="margin-top:8px">${dayHead(sheet.taken_on)}</div>
        </div>
        <button class="btn ghost block mt" onClick=${() => saveItem(sheet)}>📥 Save to device</button>
        <button class="btn ghost block mt" style="color:var(--bad);border-color:var(--bad)" onClick=${() => deleteItem(sheet)}>🗑 Delete for both</button>
        <button class="linkbtn block mt" style="width:100%" onClick=${() => setSheet(null)}>Cancel</button>
      </div>
    </div>`}
  </div>`;
}

/* ---- fullscreen lightbox: swipe between memories, videos play inline ---- */
function Lightbox({ items, index, pubUrl, onClose, onNav, onOptions }) {
  const it = items[index];
  const start = useRef(null);
  const down = (e) => { start.current = { x: e.clientX, y: e.clientY }; };
  const up = (e) => {
    const s = start.current; start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      const n = index + (dx < 0 ? 1 : -1);
      if (n >= 0 && n < items.length) onNav(n);
    } else if (Math.abs(dy) > 80 && dy > 0) onClose();   // swipe down to dismiss
  };
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index + 1 < items.length) onNav(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onNav(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length]);
  if (!it) return null;
  return html`<div class="lightbox" onPointerDown=${down} onPointerUp=${up}>
    <button class="lb-close" onClick=${onClose}>✕</button>
    <button class="lb-opts" onClick=${() => { onClose(); onOptions && onOptions(it); }}>⋯</button>
    <div class="lb-stage">
      ${it.kind === "video"
        ? html`<video key=${it.id} src=${pubUrl(it.path)} controls autoplay playsinline></video>`
        : html`<img key=${it.id} src=${pubUrl(it.path)} alt="" />`}
    </div>
    <div class="lb-meta">${dayHead(it.taken_on)} · ${index + 1} / ${items.length}</div>
  </div>`;
}

/* ---- memory match: find the two photos from the same day ---- */
function MatchGame({ items, pubUrl }) {
  const buildDeck = useCallback(() => {
    const byDay = {};
    for (const it of items) if (it.kind === "photo") (byDay[it.taken_on] = byDay[it.taken_on] || []).push(it);
    const days = Object.keys(byDay).filter((d) => byDay[d].length >= 2);
    const picked = days.sort(() => Math.random() - 0.5).slice(0, 6);
    const cards = [];
    for (const d of picked) {
      const pool = [...byDay[d]].sort(() => Math.random() - 0.5).slice(0, 2);
      for (const it of pool) cards.push({ key: it.id + "-" + Math.random().toString(36).slice(2, 5), day: d, it });
    }
    return cards.sort(() => Math.random() - 0.5);
  }, [items]);

  const [deck, setDeck] = useState(buildDeck);
  const [open, setOpen] = useState([]);        // up to 2 card keys
  const [matched, setMatched] = useState([]);  // matched days
  const [flips, setFlips] = useState(0);
  const lock = useRef(false);

  const tap = (card) => {
    if (lock.current || open.includes(card.key) || matched.includes(card.day)) return;
    const next = [...open, card.key];
    setOpen(next);
    setFlips((f) => f + 1);
    if (next.length === 2) {
      const [a, b] = next.map((k) => deck.find((c) => c.key === k));
      if (a.day === b.day) {
        lock.current = true;
        setTimeout(() => { setMatched((m) => [...m, a.day]); setOpen([]); lock.current = false;
          try { navigator.vibrate && navigator.vibrate([40, 30, 60]); } catch {} }, 450);
      } else {
        lock.current = true;
        setTimeout(() => { setOpen([]); lock.current = false; }, 950);
      }
    }
  };

  const won = deck.length > 0 && matched.length === deck.length / 2;
  if (deck.length < 4) return html`<div class="empty"><span class="big">🃏</span>Need a few more same-day photos to play.</div>`;

  return html`<div class="match">
    <div class="row between" style="margin:10px 0 12px">
      <span class="eyebrow">Find the same-day pairs</span>
      <span class="tiny muted tnum">${flips} flips</span>
    </div>
    <div class="matchgrid">
      ${deck.map((c) => {
        const faceUp = open.includes(c.key) || matched.includes(c.day);
        const done = matched.includes(c.day);
        return html`<button class=${`mcard ${faceUp ? "up" : ""} ${done ? "done" : ""}`} key=${c.key} onClick=${() => tap(c)}>
          <div class="mcard-inner">
            <div class="mcard-back">🍑🧸</div>
            <div class="mcard-face"><img src=${pubUrl(c.it.path)} loading="lazy" alt="" /></div>
          </div>
        </button>`;
      })}
    </div>
    ${won && html`<div class="center" style="padding:16px 0 4px">
      <div class="gamehero-title" style="font-size:22px">Matched in ${flips} flips 💗</div>
      <button class="btn mt" onClick=${() => { setDeck(buildDeck()); setOpen([]); setMatched([]); setFlips(0); }}>Play again</button>
    </div>`}
  </div>`;
}
