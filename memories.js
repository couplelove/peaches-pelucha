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
// Draw any decoded source (ImageBitmap, <img>, or <video>) into a canvas
// downscaled so its longest edge is `maxDim`. object-fit:cover crop optional.
function canvasOf(src, maxDim, square) {
  const w0 = src.videoWidth || src.naturalWidth || src.width;
  const h0 = src.videoHeight || src.naturalHeight || src.height;
  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d");
  if (square) {
    cv.width = cv.height = maxDim;
    const s = Math.max(maxDim / w0, maxDim / h0);
    const dw = w0 * s, dh = h0 * s;
    ctx.drawImage(src, (maxDim - dw) / 2, (maxDim - dh) / 2, dw, dh);
  } else {
    const s = Math.min(1, maxDim / Math.max(w0, h0));
    cv.width = Math.round(w0 * s); cv.height = Math.round(h0 * s);
    ctx.drawImage(src, 0, 0, cv.width, cv.height);
  }
  return cv;
}
// Encode a canvas, preferring WebP but honestly falling back to JPEG when the
// browser can't encode WebP (iOS < 16). Reports the real type so paths/CT match.
async function encodeCanvas(cv, q, preferWebp = true) {
  if (preferWebp) {
    const w = await new Promise((r) => cv.toBlob(r, "image/webp", q));
    if (w && w.type === "image/webp") return { blob: w, ext: "webp", ct: "image/webp" };
  }
  const j = await new Promise((r) => cv.toBlob(r, "image/jpeg", q));
  if (!j) throw new Error("couldn’t encode image");
  return { blob: j, ext: "jpg", ct: "image/jpeg" };
}
// tiny blurred placeholder as a data-URL (~20px). Stretched + blurred in CSS.
function blurDataURL(src) {
  const cv = canvasOf(src, 20, true);
  try { const u = cv.toDataURL("image/webp", 0.5); if (u.startsWith("data:image/webp")) return u; } catch {}
  try { return cv.toDataURL("image/jpeg", 0.4); } catch { return null; }
}
// One decode → full (1600 JPEG), thumb (400 WebP/JPEG), blur (20px data-URL).
async function processPhoto(file) {
  const src = await decodeImage(file);            // throws if truly undecodable
  try {
    const full = await encodeCanvas(canvasOf(src, 1600), 0.82, false);   // keep full as JPEG
    const thumb = await encodeCanvas(canvasOf(src, 400, true), 0.8);
    const blur = blurDataURL(src);
    return { full: full.blob, thumb, blur };
  } finally {
    if (src.close) try { src.close(); } catch {}
    if (src.src) try { URL.revokeObjectURL(src.src); } catch {}
  }
}
// Capture a poster frame + blur from a video, on-device. Returns null on any
// hiccup (the grid then falls back to a neutral tile). Watchdog-guarded — a
// video that never fires loadeddata/seeked won't hang the upload.
function videoPoster(file) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto";
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (val) => { if (done) return; done = true; clearTimeout(wd); try { URL.revokeObjectURL(url); } catch {} resolve(val); };
    const grab = async () => {
      try {
        const thumb = await encodeCanvas(canvasOf(v, 400, true), 0.8);
        const blur = blurDataURL(v);
        finish({ thumb, blur });
      } catch { finish(null); }
    };
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); } catch { grab(); } };
    v.onseeked = grab;
    v.onerror = () => finish(null);
    const wd = setTimeout(() => finish(null), 6000);
    v.src = url;
  });
}

/* ---- capture metadata: the photo knows when and where it was taken -------
   EXIF lives as a TIFF block after an "Exif\0\0" marker — in JPEGs and HEICs
   alike — so one byte-scan covers both. Videos carry a creation time in the
   MP4 'mvhd' box. file.lastModified is the LAST resort (phones often stamp it
   with the pick time, which was the whole bug). */
async function exifMeta(file) {
  try {
    const buf = new Uint8Array(await file.slice(0, 4 * 1024 * 1024).arrayBuffer());
    let i = -1;
    for (let k = 0; k < buf.length - 6; k++) {
      if (buf[k] === 0x45 && buf[k+1] === 0x78 && buf[k+2] === 0x69 && buf[k+3] === 0x66 && buf[k+4] === 0 && buf[k+5] === 0) { i = k + 6; break; }
    }
    if (i < 0) return {};
    const dv = new DataView(buf.buffer, i);
    const big = dv.getUint16(0) === 0x4d4d;
    const u16 = (o) => dv.getUint16(o, !big);
    const u32 = (o) => dv.getUint32(o, !big);
    const found = {};
    const readIFD = (off, tags) => {
      let n; try { n = u16(off); } catch { return; }
      for (let k = 0; k < n; k++) {
        const e = off + 2 + k * 12;
        const tag = u16(e);
        if (tags[tag]) found[tags[tag]] = { type: u16(e + 2), count: u32(e + 4), value: u32(e + 8), entry: e };
      }
    };
    readIFD(u32(4), { 0x8769: "exifPtr", 0x8825: "gpsPtr", 0x0132: "dt" });
    if (found.exifPtr) readIFD(found.exifPtr.value, { 0x9003: "dto" });
    if (found.gpsPtr) readIFD(found.gpsPtr.value, { 1: "latRef", 2: "lat", 3: "lngRef", 4: "lng" });
    const out = {};
    // TIFF rule: values that fit in 4 bytes live INLINE in the entry; bigger
    // ones live behind a pointer. GPS refs ("N"/"W", 2 bytes) are inline.
    const dataAt = (f, byteLen) => (byteLen <= 4 ? f.entry + 8 : f.value);
    const ascii = (f) => { const off = dataAt(f, f.count); let s = ""; for (let k = 0; k < f.count - 1; k++) s += String.fromCharCode(dv.getUint8(off + k)); return s; };
    const dtf = found.dto || found.dt;
    if (dtf) {
      const m = ascii(dtf).match(/(\d{4}):(\d{2}):(\d{2})/);
      if (m) out.taken_on = `${m[1]}-${m[2]}-${m[3]}`;
    }
    const rat3 = (f) => { const v = []; for (let k = 0; k < 3; k++) v.push(u32(f.value + k * 8) / (u32(f.value + k * 8 + 4) || 1)); return v[0] + v[1] / 60 + v[2] / 3600; };
    if (found.lat && found.lng) {
      let lat = rat3(found.lat), lng = rat3(found.lng);
      if (found.latRef && ascii(found.latRef) === "S") lat = -lat;
      if (found.lngRef && ascii(found.lngRef) === "W") lng = -lng;
      if (isFinite(lat) && isFinite(lng) && (lat || lng)) { out.lat = +lat.toFixed(5); out.lng = +lng.toFixed(5); }
    }
    return out;
  } catch { return {}; }
}

async function mp4Date(file) {
  try {
    const buf = new Uint8Array(await file.slice(0, 2 * 1024 * 1024).arrayBuffer());
    for (let k = 0; k < buf.length - 24; k++) {
      if (buf[k] === 0x6d && buf[k+1] === 0x76 && buf[k+2] === 0x68 && buf[k+3] === 0x64) { // 'mvhd'
        const dv = new DataView(buf.buffer, k + 4);
        const version = dv.getUint8(0);
        const secs = version === 1 ? Number(dv.getBigUint64(4)) : dv.getUint32(4);
        const ms = (secs - 2082844800) * 1000;            // 1904 epoch → unix
        if (ms > 631152000000 && ms < Date.now() + 86400000) {  // sanity: after 1990
          const d = new Date(ms);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        }
      }
    }
  } catch {}
  return null;
}

// free, key-less reverse geocode (BigDataCloud client API) — best effort
async function placeFor(lat, lng) {
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`);
    const j = await r.json();
    const town = j.city || j.locality || j.principalSubdivision;
    if (!town) return null;
    const region = (j.principalSubdivisionCode || "").split("-")[1] || j.countryCode;
    return region && region !== town ? `${town}, ${region}` : town;
  } catch { return null; }
}

// Retry a Supabase call that resolves to {error} OR throws on a dropped
// connection — mobile networks drop large bodies routinely, and a thrown
// network error must be retried, not allowed to escape. Exponential backoff
// with jitter (so parallel lanes don't retry in lockstep), capped; the final
// failure propagates so the caller can mark the file failed.
async function withRetry(fn, attempts = 5, base = 800) {
  let lastErr = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fn();
      if (!res || !res.error) return res;
      lastErr = res.error;
    } catch (e) { lastErr = e; }
    if (attempt < attempts - 1)
      await new Promise((r) => setTimeout(r, Math.min(base * 2 ** attempt, 8000) + Math.random() * 500));
  }
  throw lastErr || new Error("failed");
}

const uploadWithRetry = (client, path, blob, contentType) =>
  withRetry(() => client.storage.from("memories")
    .upload(path, blob, { contentType, cacheControl: "31536000", upsert: true }));

// the grid needs only these columns — never pull the (large, unused) lat/lng or
// any future heavy column into the list query. blur is a tiny inline data-URL.
const SELECT_COLS = "id,path,thumb_path,blur,kind,taken_on,place,created_at";
const PAGE = 60;                                     // rows per infinite-scroll page
// gallery order: newest-taken first, then newest-uploaded — the comparator that
// keeps the in-memory list sorted as realtime rows merge in.
const memCmp = (a, b) =>
  a.taken_on < b.taken_on ? 1 : a.taken_on > b.taken_on ? -1
  : a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;

// chapter title shown until the AI weaves a real one
const fallbackTitle = (g) => (g.items.find((i) => i.place) || {}).place || "A Day Together";
// shown under a day until its AI story is woven (placeholder, never empty)
const fallbackStory = (g) => {
  const place = (g.items.find((i) => i.place) || {}).place;
  const n = g.items.length, moments = n === 1 ? "moment" : "moments";
  return place ? `${place} — ${n} ${moments} from the day.` : `${n} ${moments} you kept from this day.`;
};

export function MemoriesTab({ client, me, flash }) {
  const [items, setItems] = useState(null);          // null = loading; else loaded window (paged)
  const [view, setView] = useState("gallery");       // 'gallery' | 'game'
  const [lightbox, setLightbox] = useState(null);    // index into items
  const [uploads, setUploads] = useState(null);      // {done, total} | null
  const fileInput = useRef(null);
  // pagination cursor lives in a ref (no re-render churn): how many rows we've
  // pulled via range(), whether the tail is reached, and an in-flight guard.
  const more = useRef({ offset: 0, done: false, loading: false });
  const sentinel = useRef(null);                     // IntersectionObserver target
  const [stories, setStories] = useState({});        // day -> { title, story }
  const storyTried = useRef(new Set());              // days we've already asked to generate this session
  const [dayOpen, setDayOpen] = useState(null);      // the day whose photo grid is open (null = title-card feed)
  const [events, setEvents] = useState([]);          // calendar events, to cite the ones that fell on a day

  const pubUrl = useCallback((path) => {
    try { return client.storage.from("memories").getPublicUrl(path).data.publicUrl; }
    catch { return ""; }
  }, [client]);
  // the grid/game load the small thumb; fall back to the full image for legacy
  // rows that predate thumbnails (thumb_path null).
  const thumbUrl = useCallback((it) => pubUrl(it.thumb_path || it.path), [pubUrl]);

  const pageQuery = useCallback((from, to) =>
    client.from("memories").select(SELECT_COLS)
      .order("taken_on", { ascending: false }).order("created_at", { ascending: false })
      .range(from, to), [client]);

  // initial page (also used to reset after a hard refresh)
  const load = useCallback(async () => {
    const m = more.current; m.loading = true;
    const { data, error } = await pageQuery(0, PAGE - 1);
    m.loading = false;
    m.offset = (data || []).length;
    m.done = !data || data.length < PAGE;
    setItems(error ? [] : (data || []));
  }, [pageQuery]);

  // next page — keyset would be ideal at huge scale, but offset+dedupe is robust
  // here: a realtime insert above the window just makes range() re-read one seen
  // row, which the id-dedupe drops (no gap, no dupe).
  const loadMore = useCallback(async () => {
    const m = more.current;
    if (m.loading || m.done) return;
    m.loading = true;
    const { data, error } = await pageQuery(m.offset, m.offset + PAGE - 1);
    m.loading = false;
    if (error) return;
    const rows = data || [];
    m.offset += rows.length;
    if (rows.length < PAGE) m.done = true;
    setItems((cur) => {
      const seen = new Set((cur || []).map((r) => r.id));
      const add = rows.filter((r) => !seen.has(r.id));
      return [...(cur || []), ...add];
    });
  }, [pageQuery]);

  // re-pull page 0 and upsert — catches anything realtime missed while the phone
  // was asleep, without discarding the pages already scrolled into view.
  const refresh = useCallback(async () => {
    const { data } = await pageQuery(0, PAGE - 1);
    if (!data) return;
    setItems((cur) => {
      if (!cur) return data;
      const map = new Map(cur.map((r) => [r.id, r]));
      for (const r of data) map.set(r.id, r);
      return [...map.values()].sort(memCmp);
    });
  }, [pageQuery]);

  // merge ONE realtime row instead of refetching the whole library.
  const mergeRow = useCallback((payload) => {
    setItems((cur) => {
      if (!cur) return cur;
      if (payload.eventType === "DELETE") {
        const id = payload.old && payload.old.id;
        return id ? cur.filter((r) => r.id !== id) : cur;
      }
      const row = payload.new;
      if (!row) return cur;
      const without = cur.filter((r) => r.id !== row.id);
      // if it sorts older than our last loaded row and there are still unloaded
      // pages, let pagination surface it later rather than stranding it mid-list.
      const last = without[without.length - 1];
      if (!more.current.done && last && memCmp(row, last) > 0) return without;
      return [...without, row].sort(memCmp);
    });
  }, []);

  useEffect(() => {
    load();
    let ch = null;
    try {
      ch = client.channel("pp-memories")
        .on("postgres_changes", { event: "*", schema: "public", table: "memories" }, mergeRow)
        .subscribe();
    } catch {}
    const wake = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", wake);
    return () => { document.removeEventListener("visibilitychange", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load, refresh, mergeRow]);

  // infinite scroll: a sentinel below the grid pulls the next page as it nears.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || view !== "gallery") return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) loadMore(); }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, view, items === null]);

  // Concurrent upload queue (2 lanes) with per-file status — photos shrink
  // on-device first; videos go as-is. Two lanes (not three) keeps fewer large
  // bodies in flight on a phone uplink, so a dropped connection loses less and
  // each request is less likely to time out; the shrunk photos still fly.
  const onPick = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    const jobs = files.map((f, i) => ({ i, f, status: "queued" }));
    const forceDay = dayOpen;                         // picking inside an open day → the file belongs to THAT day
    const added = [];                                 // inserted rows, merged in immediately (survives pagination)
    const paint = () => setUploads({ done: jobs.filter((j) => j.status === "done" || j.status === "failed").length, total: jobs.length, failed: jobs.filter((j) => j.status === "failed").length });
    paint();
    const runJob = async (j) => {
      const f = j.f;
      try {
        const isVideo = f.type.startsWith("video/");
        if (isVideo && f.size > 490 * 1024 * 1024) throw new Error("video over 500MB — trim it first");
        j.status = "working"; paint();
        const base = `u${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        // real capture metadata comes from the ORIGINAL file bytes (before shrink)
        const meta = isVideo ? { taken_on: await mp4Date(f) } : await exifMeta(f);
        let blob, ext, ct, thumb = null, blur = null;
        if (isVideo) {
          blob = f; ext = f.name.toLowerCase().endsWith(".mov") ? "mov" : "mp4"; ct = f.type || "video/mp4";
          const poster = await videoPoster(f);                 // best-effort; null is fine
          if (poster) { thumb = poster.thumb; blur = poster.blur; }
        } else {
          try {
            const out = await processPhoto(f);
            blob = out.full; ext = "jpg"; ct = "image/jpeg";
            thumb = out.thumb; blur = out.blur;
          } catch {
            // undecodable on THIS device (e.g. HEIC opened in desktop Chrome, or
            // a canvas that ran out of memory) — save the ORIGINAL bytes rather
            // than lose the memory. The grid falls back to the full image when a
            // row has no thumb, and the couple's phones (Safari/iOS) render HEIC.
            blob = f;
            ct = f.type || "image/jpeg";
            ext = ((f.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "")) || "jpg";
          }
        }
        const path = `${base}.${ext}`;
        await uploadWithRetry(client, path, blob, ct);
        // thumbnail/poster is a separate small object; failure here is non-fatal
        // (grid falls back to the full image), so don't sink the whole upload.
        let thumb_path = null;
        if (thumb) {
          thumb_path = `t${base.slice(1)}.${thumb.ext}`;
          try { await uploadWithRetry(client, thumb_path, thumb.blob, thumb.ct); }
          catch { thumb_path = null; }
        }
        let taken_on = forceDay || meta.taken_on;     // an open day wins over the photo's own capture date
        if (!taken_on) {
          const taken = new Date(f.lastModified || Date.now());
          taken_on = `${taken.getFullYear()}-${String(taken.getMonth() + 1).padStart(2, "0")}-${String(taken.getDate()).padStart(2, "0")}`;
        }
        const place = meta.lat != null ? await placeFor(meta.lat, meta.lng) : null;
        // the bytes are already in Storage — don't lose the memory to one
        // transient DB blip. Retry the row insert with the same backoff, and get
        // the row back so we can show it instantly (even in a day outside the
        // currently-loaded page window).
        const res = await withRetry(() => client.from("memories")
          .insert({ path, kind: isVideo ? "video" : "photo", taken_on, uploaded_by: me.id,
                    place, lat: meta.lat ?? null, lng: meta.lng ?? null, thumb_path, blur })
          .select(SELECT_COLS).single());
        if (res && res.data) added.push(res.data);
        j.status = "done";
      } catch (err) {
        j.status = "failed"; j.err = err.message || "failed";
      }
      paint();
    };
    const lanes = Array.from({ length: 2 }, async () => {
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
    // merge the new rows in immediately so they appear in their day at once —
    // including a day below the loaded window (uploading into an opened old day).
    if (added.length) setItems((cur) => {
      const map = new Map((cur || []).map((r) => [r.id, r]));
      for (const r of added) map.set(r.id, r);
      return [...map.values()].sort(memCmp);
    });
    if (ok) refresh();                                // also reconcile with the server
    if (failed.length) flash(`⚠️ ${failed.length} failed (${failed[0].err})${ok ? ` · ${ok} added` : ""}`);
    else if (ok) flash(`Added ${ok} ${ok === 1 ? "memory" : "memories"} 📸`);
  };

  // tap & hold ANY memory → start multi-select (and grab that one). Quick tap →
  // lightbox. Single-item options (save/date/place/delete) live on the
  // lightbox's ⋯ button.
  const [sheet, setSheet] = useState(null);          // single-item options sheet
  const press = useRef(null);
  const origin = useRef(null);                       // where the tap landed → lightbox zooms from there
  const holdStart = (it) => (e) => {
    const sx = e.clientX, sy = e.clientY;
    press.current = { sx, sy, fired: false, t: setTimeout(() => {
      press.current = { fired: true };
      try { navigator.vibrate && navigator.vibrate(30); } catch {}
      setSel((s) => { const n = new Set(s || []); n.add(it.id); return n; });   // enter select mode + select this one
    }, 420) };
  };
  const holdEnd = (it) => (e) => {
    const p = press.current;
    if (p && p.t) clearTimeout(p.t);
    const fired = p && p.fired;
    press.current = null;
    if (!fired) {                                    // quick tap → lightbox
      const r = e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : null;
      origin.current = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      setLightbox(flat.indexOf(it));
    }
  };
  // any real movement before the timer fires = a scroll/drag, not a hold → cancel
  const holdCancel = (e) => {
    const p = press.current;
    if (!p || !p.t) return;
    const moved = e && e.clientX != null && p.sx != null
      ? Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 10 : true;
    if (moved) { clearTimeout(p.t); press.current = null; }
  };

  /* ---- select mode: tap to toggle, drag across cells to sweep-select ----
     (cells get touch-action: pan-y, so vertical scrolling still works) */
  const [sel, setSel] = useState(null);              // null = browsing; Set of ids = selecting
  const [editor, setEditor] = useState(null);        // {type:'date'|'place', ids:[...]}
  const [busy, setBusy] = useState(false);
  const edInput = useRef(null);
  const dragSel = useRef(null);
  const selToggle = (id, to) => setSel((s) => { const n = new Set(s); to ? n.add(id) : n.delete(id); return n; });
  // Deliberate gesture: we do NOT toggle on touch-down. A stationary release is
  // a tap (toggle one). A HORIZONTAL drag engages sweep-select. A VERTICAL drag
  // is a scroll and selects nothing — fixes accidental selection while scrolling.
  const selDown = (it) => (e) => {
    dragSel.current = { id: it.id, sx: e.clientX, sy: e.clientY, mode: "pending", to: !sel.has(it.id), seen: new Set() };
  };
  const selMove = (e) => {
    const d = dragSel.current;
    if (!d || d.mode === "scroll") return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (d.mode === "pending") {
      if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) { d.mode = "scroll"; return; }   // vertical → let the page scroll
      if (Math.abs(dx) > 12) {                                  // horizontal → deliberate sweep
        d.mode = "sweep"; d.seen.add(d.id); selToggle(d.id, d.to);
        try { navigator.vibrate && navigator.vibrate(10); } catch {}
      } else return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el && el.closest && el.closest(".memcell[data-id]");
    const id = cell && cell.dataset.id;
    if (id && !d.seen.has(id)) { d.seen.add(id); selToggle(id, d.to); try { navigator.vibrate && navigator.vibrate(4); } catch {} }
  };
  const selUp = () => {
    const d = dragSel.current; dragSel.current = null;
    if (d && d.mode === "pending") { selToggle(d.id, d.to); try { navigator.vibrate && navigator.vibrate(6); } catch {} }  // tap → toggle one
  };
  const selCancel = () => { dragSel.current = null; };       // scroll began → make no selection
  const dayToggle = (g) => () => {
    const all = g.items.every((i) => sel.has(i.id));
    setSel((s) => { const n = new Set(s); g.items.forEach((i) => (all ? n.delete(i.id) : n.add(i.id))); return n; });
    try { navigator.vibrate && navigator.vibrate(8); } catch {}
  };

  const bulkDelete = async () => {
    const its = (items || []).filter((it) => sel.has(it.id));
    if (!its.length) return;
    if (!confirm(`Delete ${its.length === 1 ? "this memory" : `these ${its.length} memories`} for both of you?`)) return;
    setBusy(true);
    try {
      try { await client.storage.from("memories").remove(its.flatMap((i) => i.thumb_path ? [i.path, i.thumb_path] : [i.path])); } catch {}
      const { error } = await client.from("memories").delete().in("id", its.map((i) => i.id));
      if (error) throw error;
      const gone = new Set(its.map((i) => i.id));
      setItems((cur) => (cur || []).filter((r) => !gone.has(r.id)));
      flash(`Deleted ${its.length}`);
      setSel(null);
    } catch (err) { flash("⚠️ " + (err.message || "delete failed")); }
    setBusy(false);
  };

  const editorDefault = () => {
    const first = (items || []).find((i) => editor.ids.includes(i.id));
    return editor.type === "date" ? (first ? first.taken_on : "") : ((first && first.place) || "");
  };
  const applyEditor = async (clear) => {
    const ids = editor.ids;
    let patch;
    if (editor.type === "date") {
      const v = edInput.current && edInput.current.value;
      if (!v) return;
      patch = { taken_on: v };
    } else {
      const v = clear === true ? "" : ((edInput.current && edInput.current.value) || "").trim();
      patch = { place: v || null, lat: null, lng: null };   // hand-set place ≠ the photo's GPS
    }
    setBusy(true);
    try {
      const { error } = await client.from("memories").update(patch).in("id", ids);
      if (error) throw error;
      const idset = new Set(ids);
      setItems((cur) => (cur || []).map((r) => idset.has(r.id) ? { ...r, ...patch } : r).sort(memCmp));
      flash(`${editor.type === "date" ? "📅" : "📍"} ${ids.length} updated`);
      setEditor(null); setSheet(null); setSel(null);
    } catch (err) { flash("⚠️ " + (err.message || "update failed")); }
    setBusy(false);
  };

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
      await client.storage.from("memories").remove([it.path, ...(it.thumb_path ? [it.thumb_path] : [])]);
      await client.from("memories").delete().eq("id", it.id);
      setItems((cur) => (cur || []).filter((r) => r.id !== it.id));
      flash("Deleted");
      setSheet(null);
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

  // ---- AI day-stories: load cached ones, then weave the newest few that are
  // missing (Claude vision via the `day-story` edge function). Bounded per
  // session so a lifetime of days doesn't fan out into a flood of calls.
  useEffect(() => {
    const days = groups.map((g) => g.date).filter(Boolean);
    if (!days.length) return;
    let live = true;
    client.from("day_stories").select("day,title,story").in("day", days).then(({ data }) => {
      if (!live || !data) return;
      const got = {}; data.forEach((r) => { got[r.day] = { title: r.title, story: r.story }; });
      setStories((s) => ({ ...got, ...s }));
      // queue the newest storyless days (cap 6) — but weave them DEFERRED and
      // ONE AT A TIME, so these long edge-function calls never compete with the
      // feed's image loading on the same origin (faster first paint on mobile).
      const queue = [];
      for (const g of groups) {
        if (queue.length >= 6) break;
        if (!g.date || got[g.date] || stories[g.date] || storyTried.current.has(g.date)) continue;
        storyTried.current.add(g.date); queue.push(g);
      }
      if (queue.length) {
        const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1400));
        idle(async () => { for (const g of queue) { if (!live) break; await weaveStory(g); } });
      }
    });
    return () => { live = false; };
  }, [groups, client]);

  // calendar events — so a day can cite what was planned/happening then
  useEffect(() => {
    let live = true;
    client.from("events").select("id,title,emoji,starts_on").then(({ data }) => { if (live && data) setEvents(data); });
    return () => { live = false; };
  }, [client]);

  const weaveStory = useCallback(async (g) => {
    const images = g.items.filter((it) => it.kind === "photo").map((it) => pubUrl(it.thumb_path || it.path)).filter(Boolean).slice(0, 6);
    if (!images.length) return;
    const place = (g.items.find((i) => i.place) || {}).place || null;
    const sig = g.items.length + ":" + g.items[0].id;
    try {
      const { data } = await client.functions.invoke("day-story", {
        body: { day: g.date, images, context: { date: dayHead(g.date), place, count: g.items.length, sig } },
      });
      if (data && data.story) setStories((s) => ({ ...s, [g.date]: { title: data.title, story: data.story } }));
    } catch { /* fall back to the metadata line */ }
  }, [client, pubUrl]);

  const flat = items || [];
  const openGroup = dayOpen ? groups.find((g) => g.date === dayOpen) : null;

  // one photo/video tile (used in a day's grid)
  const cell = (it) => html`<button class=${`memcell ${sel ? "selble" : ""} ${sel && sel.has(it.id) ? "selon" : ""}`} key=${it.id} data-id=${it.id}
    onPointerDown=${sel ? selDown(it) : holdStart(it)} onPointerUp=${sel ? selUp : holdEnd(it)}
    onPointerMove=${sel ? selMove : holdCancel} onPointerCancel=${sel ? selCancel : holdCancel}
    onContextMenu=${(e) => e.preventDefault()}>
    ${it.blur && html`<span class="memblur" style=${`background-image:url(${it.blur})`}></span>`}
    ${it.kind === "video" && !it.thumb_path
      ? html`<video src=${pubUrl(it.path) + "#t=0.1"} preload="metadata" muted playsinline
          onLoadedData=${(e) => e.target.classList.add("ld")}
          ref=${(el) => { if (el && el.readyState >= 2) el.classList.add("ld"); }}></video>`
      : html`<img src=${thumbUrl(it)} loading="lazy" decoding="async" alt="" crossorigin="anonymous"
          onLoad=${(e) => e.target.classList.add("ld")}
          ref=${(el) => { if (el && el.complete && el.naturalWidth) el.classList.add("ld"); }} />`}
    ${it.kind === "video" && html`<span class="memplay">🎥</span>`}
    ${sel && html`<span class="selbadge">${sel.has(it.id) ? "✓" : ""}</span>`}
  </button>`;

  return html`<div>
    <div class="card">
      <div class="shead">
        <h2>Memories</h2>
        <div class="shead-actions">
          ${sel ? html`<button class="btn sm" onClick=${() => setSel(null)}>Done</button>`
          : html`<div class="seg" style="padding:3px">
            <button class=${view === "gallery" ? "on" : ""} onClick=${() => setView("gallery")}>Gallery</button>
            <button class=${view === "game" ? "on" : ""} onClick=${() => setView("game")}>Match</button>
          </div>
          ${view === "gallery" && dayOpen && html`<button class="linkbtn micro" onClick=${() => setSel(new Set())}>Select</button>`}
          <button class="btn sm" disabled=${!!uploads} onClick=${() => fileInput.current && fileInput.current.click()}>
            ${uploads ? `${uploads.done}/${uploads.total}…` : "＋ Add"}
          </button>`}
        </div>
      </div>
      <input ref=${fileInput} type="file" accept="image/*,video/*" multiple style="display:none" onChange=${onPick} />

      ${uploads && html`<div class="upbar"><div class="upbar-fill" style=${`width:${Math.round((uploads.done / uploads.total) * 100)}%`}></div></div>`}
      ${uploads && html`<div class="tiny muted" style="margin:-6px 0 10px">uploading ${uploads.done}/${uploads.total}${uploads.failed ? ` · ${uploads.failed} failed` : ""}</div>`}

      ${items === null && html`<div class="memskel">${[...Array(9)].map((_, i) => html`<div class="memskel-cell" key=${i}></div>`)}</div>`}
      ${items !== null && items.length === 0 && html`<div class="empty"><span class="big">📸</span>No memories yet — add your first.</div>`}

      <!-- title-card feed: scroll the days like a journey; tap a card to open the day -->
      ${view === "gallery" && items !== null && !openGroup && html`<div class="dayfeed">
        ${groups.map((g, gi) => {
          const s = stories[g.date];
          const cover = g.items.find((i) => i.kind === "photo") || g.items[0];
          const heroSrc = cover.thumb_path ? pubUrl(cover.thumb_path) : (cover.kind === "photo" ? pubUrl(cover.path) : null);
          const evs = events.filter((e) => e.starts_on === g.date);
          // blur-up placeholder (instant) under a natively lazy hero (off-screen cards never fetch)
          return html`<button class="daytile" key=${g.date} style=${cover.blur ? `background-image:url(${cover.blur})` : ""} onClick=${() => setDayOpen(g.date)}>
            ${heroSrc && html`<img class="dt-img" src=${heroSrc} alt="" decoding="async" crossorigin="anonymous"
              loading=${gi === 0 ? "eager" : "lazy"} fetchpriority=${gi === 0 ? "high" : "auto"}
              onLoad=${(e) => e.target.classList.add("ld")}
              ref=${(el) => { if (el && el.complete && el.naturalWidth) el.classList.add("ld"); }} />`}
            <span class="dt-scrim"></span>
            ${evs.length ? html`<span class="dt-ev" title=${evs.map((e) => e.title).join(", ")}>${evs[0].emoji || "📌"}${evs.length > 1 ? ` +${evs.length - 1}` : ""}</span>` : ""}
            <span class="dt-count">${g.items.length} 📸</span>
            <span class="dt-body">
              <span class="dt-date">${dayHead(g.date)}</span>
              <span class="dt-title">${(s && s.title) || fallbackTitle(g)}</span>
              <span class="dt-story">${(s && s.story) || fallbackStory(g)}</span>
            </span>
          </button>`;
        })}
        <div ref=${sentinel} class="memsentinel">${!more.current.done ? html`<span class="memspin"></span>` : ""}</div>
      </div>`}

      <!-- a single day: its story, then the full photo grid -->
      ${view === "gallery" && openGroup && html`<div class="daydetail">
        <button class="dd-back" onClick=${() => setDayOpen(null)}>‹ All days</button>
        <div class="dd-head">
          <div class="dd-date">${dayHead(openGroup.date)}</div>
          <div class="dd-title">${(stories[openGroup.date] && stories[openGroup.date].title) || fallbackTitle(openGroup)}</div>
          <p class="dd-story">${(stories[openGroup.date] && stories[openGroup.date].story) || fallbackStory(openGroup)}</p>
          ${(() => { const evs = events.filter((e) => e.starts_on === openGroup.date); return evs.length ? html`<div class="dd-events">
            <span class="dd-ev-label">📌 that day</span>
            ${evs.map((e) => html`<span class="dd-ev" key=${e.id}>${e.emoji || "•"} ${e.title}</span>`)}
          </div>` : ""; })()}
          ${sel && html`<button class=${`dayall ${openGroup.items.every((i) => sel.has(i.id)) ? "on" : ""}`} onClick=${dayToggle(openGroup)}>✓ Select all this day</button>`}
        </div>
        <div class="memgrid">${openGroup.items.map(cell)}</div>
      </div>`}

      ${view === "game" && items !== null && html`<${MatchGame} items=${items} pubUrl=${pubUrl} thumbUrl=${thumbUrl} />`}
    </div>

    ${lightbox !== null && html`<${Lightbox} items=${flat} index=${lightbox} pubUrl=${pubUrl} origin=${origin.current}
      onClose=${() => setLightbox(null)} onNav=${(i) => setLightbox(i)} onOptions=${(it) => setSheet(it)} />`}

    ${sheet && html`<div class="modal-bg asheet" onClick=${(e) => { if (e.target.classList.contains("modal-bg")) setSheet(null); }}>
      <div class="modal">
        <div class="handle"></div>
        <div class="asheet-preview">
          <span class="apv-media">
            ${sheet.kind === "video" && !sheet.thumb_path
              ? html`<video src=${pubUrl(sheet.path) + "#t=0.1"} preload="metadata" muted playsinline></video>`
              : html`<img src=${thumbUrl(sheet)} alt="" crossorigin="anonymous" />`}
            ${sheet.kind === "video" && html`<span class="memplay">🎥</span>`}
          </span>
          <div class="tiny muted" style="margin-top:8px">${dayHead(sheet.taken_on)}${sheet.place ? " · 📍 " + sheet.place : ""}</div>
        </div>
        <button class="btn ghost block mt" onClick=${() => saveItem(sheet)}>📥 Save to device</button>
        <div class="sheetduo mt">
          <button class="btn ghost" onClick=${() => setEditor({ type: "date", ids: [sheet.id] })}>📅 Date</button>
          <button class="btn ghost" onClick=${() => setEditor({ type: "place", ids: [sheet.id] })}>📍 Place</button>
        </div>
        <button class="btn ghost block mt" style="color:var(--bad);border-color:var(--bad)" onClick=${() => deleteItem(sheet)}>🗑 Delete for both</button>
        <button class="linkbtn block mt" style="width:100%" onClick=${() => setSheet(null)}>Cancel</button>
      </div>
    </div>`}

    ${sel && html`<div class="selbar">
      <span class="selcount">${sel.size}</span>
      <button class="selact" disabled=${!sel.size || busy} onClick=${() => setEditor({ type: "date", ids: [...sel] })}>📅</button>
      <button class="selact" disabled=${!sel.size || busy} onClick=${() => setEditor({ type: "place", ids: [...sel] })}>📍</button>
      <button class="selact" disabled=${!sel.size || busy} onClick=${bulkDelete}>🗑</button>
    </div>`}

    ${editor && html`<div class="modal-bg asheet" onClick=${(e) => { if (e.target.classList.contains("modal-bg")) setEditor(null); }}>
      <div class="modal">
        <div class="handle"></div>
        <div class="eyebrow" style="margin-bottom:10px">${editor.type === "date" ? "📅 date" : "📍 place"} · ${editor.ids.length} ${editor.ids.length === 1 ? "memory" : "memories"}</div>
        ${editor.type === "date"
          ? html`<input ref=${edInput} type="date" value=${editorDefault()} style="width:100%" />`
          : html`<input ref=${edInput} type="text" value=${editorDefault()} placeholder="City, ST" style="width:100%" />`}
        <button class="btn block mt" disabled=${busy} onClick=${applyEditor}>${busy ? "…" : "Apply"}</button>
        ${editor.type === "place" && html`<button class="btn ghost block mt" disabled=${busy} onClick=${() => applyEditor(true)}>Remove place</button>`}
        <button class="linkbtn block mt" style="width:100%" onClick=${() => setEditor(null)}>Cancel</button>
      </div>
    </div>`}
  </div>`;
}

/* ---- fullscreen lightbox, native-feel ------------------------------------
   - opens by ZOOMING from the tapped thumbnail (transform-origin at the cell)
   - horizontal swipes are finger-attached: prev/current/next ride a track
     that follows the drag, with rubber-band resistance at the ends and a
     spring release that commits or snaps back
   - dragging DOWN scales the media and fades the backdrop under your finger
     (release past the threshold dismisses, otherwise it springs home)      */
function Lightbox({ items, index, pubUrl, onClose, onNav, onOptions, origin }) {
  const it = items[index];
  const track = useRef(null);
  const bg = useRef(null);
  const root = useRef(null);
  const drag = useRef(null);
  const [closing, setClosing] = useState(false);
  const [entered, setEntered] = useState(false);
  const W = () => window.innerWidth;

  useEffect(() => { requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true))); }, []);

  const dismiss = useCallback(() => {
    setClosing(true);
    setTimeout(onClose, 230);
  }, [onClose]);

  // reset the track instantly (no transition) whenever the index settles
  useEffect(() => {
    const t = track.current;
    if (!t) return;
    t.style.transition = "none";
    t.style.transform = `translateX(${-W()}px)`;
  }, [index]);

  const down = (e) => {
    if (e.target.tagName === "VIDEO") return;            // let native controls work
    drag.current = { x: e.clientX, y: e.clientY, t: performance.now(), axis: null, dx: 0, dy: 0 };
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    d.dx = e.clientX - d.x; d.dy = e.clientY - d.y;
    if (!d.axis) {
      if (Math.hypot(d.dx, d.dy) < 8) return;
      d.axis = Math.abs(d.dx) > Math.abs(d.dy) ? "x" : "y";
    }
    if (d.axis === "x") {
      const atStart = index === 0 && d.dx > 0, atEnd = index === items.length - 1 && d.dx < 0;
      const dx = (atStart || atEnd) ? d.dx * 0.32 : d.dx;          // rubber-band at the ends
      track.current.style.transition = "none";
      track.current.style.transform = `translateX(${-W() + dx}px)`;
    } else if (d.dy > 0) {                                          // pull-down to dismiss
      const p = Math.min(1, d.dy / 320);
      track.current.style.transition = "none";
      track.current.style.transform = `translateX(${-W()}px) translateY(${d.dy * 0.82}px) scale(${1 - p * 0.18})`;
      if (bg.current) bg.current.style.opacity = String(1 - p * 0.65);
    }
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.axis) return;
    const vel = Math.abs(d.dx) / Math.max(1, performance.now() - d.t);
    const spring = "transform .26s cubic-bezier(.22,.9,.3,1.02)";
    if (d.axis === "x") {
      const go = (Math.abs(d.dx) > 72 || vel > 0.45) ? (d.dx < 0 ? 1 : -1) : 0;
      const n = index + go;
      if (go !== 0 && n >= 0 && n < items.length) {
        track.current.style.transition = spring;
        track.current.style.transform = `translateX(${-W() * (1 + go)}px)`;
        setTimeout(() => onNav(n), 240);
      } else {
        track.current.style.transition = spring;
        track.current.style.transform = `translateX(${-W()}px)`;
      }
    } else {
      if (d.dy > 130) { dismiss(); return; }
      track.current.style.transition = spring;
      track.current.style.transform = `translateX(${-W()}px)`;
      if (bg.current) { bg.current.style.transition = "opacity .25s ease"; bg.current.style.opacity = "1"; }
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") dismiss();
      if (e.key === "ArrowRight" && index + 1 < items.length) onNav(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onNav(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, dismiss]);

  if (!it) return null;
  // Neighbour panes load only their POSTER/blur — the heavy full image or video
  // streams in only for the pane you're actually on. Full-res images develop in
  // over the blur (no white flash, no layout pop).
  const pane = (item, current) => item ? html`<div class="lb-pane" key=${item.id}>
    ${item.kind === "video"
      ? (current
          ? html`<video src=${pubUrl(item.path)} poster=${item.thumb_path ? pubUrl(item.thumb_path) : undefined} controls playsinline autoplay muted=${false}></video>`
          : item.thumb_path
            ? html`<img src=${pubUrl(item.thumb_path)} alt="" crossorigin="anonymous" /><span class="lb-play">🎥</span>`
            : html`<video src=${pubUrl(item.path) + "#t=0.1"} preload="metadata" muted playsinline></video><span class="lb-play">🎥</span>`)
      : html`<span class="lb-frame">
          ${item.blur && html`<span class="lb-blur" style=${`background-image:url(${item.blur})`}></span>`}
          <img src=${current ? pubUrl(item.path) : (item.thumb_path ? pubUrl(item.thumb_path) : pubUrl(item.path))} alt="" crossorigin="anonymous"
            onLoad=${(e) => e.target.classList.add("ld")}
            ref=${(el) => { if (el && el.complete && el.naturalWidth) el.classList.add("ld"); }} />
        </span>`}
  </div>` : html`<div class="lb-pane"></div>`;

  const ox = origin ? origin.x : W() / 2;
  const oy = origin ? origin.y : window.innerHeight / 2;
  return html`<div ref=${root} class=${`lightbox lbx ${entered && !closing ? "in" : ""}`}
    style=${`transform-origin:${ox}px ${oy}px`}
    onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}>
    <div ref=${bg} class="lb-bg"></div>
    <button class="lb-close" onClick=${dismiss}>✕</button>
    <button class="lb-opts" onClick=${() => { onClose(); onOptions && onOptions(it); }}>⋯</button>
    <div ref=${track} class="lb-track" style=${`transform:translateX(${-W()}px)`}>
      ${pane(items[index - 1], false)}
      ${pane(it, true)}
      ${pane(items[index + 1], false)}
    </div>
    <div class="lb-meta">${dayHead(it.taken_on)}${it.place ? " · 📍 " + it.place : ""} · ${index + 1} / ${items.length}</div>
  </div>`;
}

/* ---- memory match: find the two photos from the same day ---- */
function MatchGame({ items, pubUrl, thumbUrl }) {
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
            <div class="mcard-face"><img src=${thumbUrl(c.it)} loading="lazy" decoding="async" alt="" crossorigin="anonymous" /></div>
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
