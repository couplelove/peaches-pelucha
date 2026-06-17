import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useRef, useCallback, useMemo } from "https://esm.sh/preact@10.23.2/hooks";
import { createPortal } from "https://esm.sh/preact@10.23.2/compat";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

/* 🗺️ Shared map for Plans
   - Places: drop pins into free-text lists ("Places We Want to Go"), mark visited.
   - Memories: auto-plot one pin per geotagged photo-day (read-only).
   - Road trips: ordered stops + a road-following route line (OSRM, straight-line
     fallback); stops styled planned vs visited.
   The card shows a NON-INTERACTIVE preview (can't pan → never fights the app's
   swipe-to-navigate); a full-screen map opens for real exploration + adding.
   Leaflet loads lazily from a CDN (no build, no API key). Clean CARTO tiles. */

const DEFAULT_LIST = "Places We Want to Go";
const TILE = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png";
const TILE_ATTR = "© OpenStreetMap, © CARTO";

let _leaflet = null;
function loadLeaflet() {
  if (_leaflet) return _leaflet;
  _leaflet = (async () => {
    if (!document.getElementById("leaflet-css")) {
      const l = document.createElement("link");
      l.id = "leaflet-css"; l.rel = "stylesheet";
      l.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(l);
    }
    const mod = await import("https://esm.sh/leaflet@1.9.4");
    return mod.default || mod;
  })();
  return _leaflet;
}

// Road-following route via the free OSRM demo server; straight-line fallback.
async function routeLine(stops) {
  const straight = stops.map((s) => [s.lat, s.lng]);
  if (stops.length < 2) return straight;
  try {
    const coords = stops.map((s) => `${s.lng},${s.lat}`).join(";");
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
    const j = await r.json();
    if (j.code === "Ok" && j.routes && j.routes[0]) return j.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  } catch {}
  return straight;
}

const pinIcon = (L, emoji, visited) => L.divIcon({ className: "mkr", html: `<div class="mkr-pin ${visited ? "done" : ""}">${emoji || "📍"}</div>`, iconSize: [34, 40], iconAnchor: [17, 38] });
const memIcon = (L) => L.divIcon({ className: "mkr", html: `<div class="mkr-pin mem">📸</div>`, iconSize: [34, 40], iconAnchor: [17, 38] });
const stopIcon = (L, n, visited) => L.divIcon({ className: "mkr", html: `<div class="mkr-stop ${visited ? "done" : ""}">${visited ? "✓" : n}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });

// A self-contained Leaflet map. interactive=false → a frozen preview (can't pan,
// so it never steals the swipe-nav gesture). fitMode "always" refits on every
// data change (preview); "once" fits a single time on open (full-screen).
function LeafletMap({ interactive, fitMode, initialCenter, mode, pins, memDays, stops, route, listFilter, onMapClick, onPinClick, onStopClick }) {
  const elRef = useRef(null), mapRef = useRef(null), layerRef = useRef(null), LRef = useRef(null), clickRef = useRef(() => {});
  const [ready, setReady] = useState(false);
  const fitSig = useRef("");

  useEffect(() => {
    let killed = false;
    loadLeaflet().then((L) => {
      if (killed || !elRef.current || mapRef.current) return;
      LRef.current = L;
      const opts = interactive
        ? { zoomControl: true, attributionControl: true }
        : { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, tap: false };
      const map = L.map(elRef.current, opts);
      if (initialCenter) map.setView([initialCenter.lat, initialCenter.lng], 12);
      else map.setView([30, -20], 2);
      L.tileLayer(TILE, { subdomains: "abcd", maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      map.on("click", (e) => clickRef.current(e));
      mapRef.current = map; setReady(true);
      [60, 250, 500, 900].forEach((t) => setTimeout(() => { try { map.invalidateSize(); } catch {} }, t));
    });
    return () => { killed = true; if (mapRef.current) { try { mapRef.current.remove(); } catch {} mapRef.current = null; } };
  }, [interactive]);

  useEffect(() => { clickRef.current = (e) => { if (onMapClick) onMapClick(e.latlng); }; }, [onMapClick]);

  useEffect(() => {
    const L = LRef.current, map = mapRef.current, lg = layerRef.current;
    if (!ready || !L || !map || !lg) return;
    try { map.invalidateSize(); } catch {}
    lg.clearLayers();
    const pts = [];
    if (mode === "places") {
      pins.filter((p) => !listFilter || p.list === listFilter).forEach((p) => {
        const m = L.marker([p.lat, p.lng], { icon: pinIcon(L, p.emoji, p.visited) }).addTo(lg);
        if (onPinClick) m.on("click", () => onPinClick(p));
        pts.push([p.lat, p.lng]);
      });
    } else if (mode === "memories") {
      memDays.forEach((d) => { L.marker([d.lat, d.lng], { icon: memIcon(L) }).addTo(lg); pts.push([d.lat, d.lng]); });
    } else if (mode === "trips") {
      if (route && route.length > 1) L.polyline(route, { color: "#1f8c8a", weight: 4, opacity: .85, lineJoin: "round" }).addTo(lg);
      stops.forEach((s, i) => {
        const m = L.marker([s.lat, s.lng], { icon: stopIcon(L, i + 1, s.visited) }).addTo(lg);
        if (onStopClick) m.on("click", () => onStopClick(s));
        pts.push([s.lat, s.lng]);
      });
    }
    if (pts.length) {
      if (fitMode === "always") {
        const sig = mode + ":" + pts.length + ":" + (listFilter || "");
        if (sig !== fitSig.current) { fitSig.current = sig; try { map.fitBounds(pts, { padding: [28, 28], maxZoom: 13 }); } catch {} }
      } else if (!fitSig.current && !initialCenter) {
        fitSig.current = "done";
        try { map.fitBounds(pts, { padding: [50, 50], maxZoom: 14 }); } catch {}
      }
    }
    setTimeout(() => { try { map.invalidateSize(); } catch {} }, 30);
  }, [ready, mode, pins, memDays, stops, route, listFilter]);

  return html`<div ref=${elRef} class="leaflet-host"></div>`;
}

export function MapCard({ client, me, players, flash }) {
  const [mode, setMode] = useState("places");
  const [pins, setPins] = useState([]);
  const [trips, setTrips] = useState([]);
  const [selTrip, setSelTrip] = useState(null);
  const [stops, setStops] = useState([]);
  const [route, setRoute] = useState(null);
  const [memDays, setMemDays] = useState([]);
  const [listFilter, setListFilter] = useState(null);
  const [full, setFull] = useState(false);            // full-screen map open
  const [fullCenter, setFullCenter] = useState(null); // where full-screen opens centered (null = fit all)
  const [adding, setAdding] = useState(false);
  const [pinSheet, setPinSheet] = useState(null);
  const [stopSheet, setStopSheet] = useState(null);
  const [tripSheet, setTripSheet] = useState(null);

  // ---- data ----
  const loadPins = useCallback(async () => { const { data } = await client.from("map_pins").select("*").order("created_at", { ascending: false }); setPins(data || []); }, [client]);
  const loadTrips = useCallback(async () => { const { data } = await client.from("trips").select("*").order("created_at", { ascending: false }); setTrips(data || []); }, [client]);
  const loadStops = useCallback(async (tripId) => { if (!tripId) { setStops([]); return; } const { data } = await client.from("trip_stops").select("*").eq("trip_id", tripId).order("seq"); setStops(data || []); }, [client]);
  const loadMemDays = useCallback(async () => {
    const { data } = await client.from("memories").select("id,taken_on,lat,lng,place").order("taken_on", { ascending: false });
    const byDay = new Map();
    for (const m of data || []) {
      if (m.lat == null || m.lng == null) continue;
      const g = byDay.get(m.taken_on);
      if (g) g.count++; else byDay.set(m.taken_on, { date: m.taken_on, lat: m.lat, lng: m.lng, place: m.place, count: 1 });
    }
    setMemDays([...byDay.values()]);
  }, [client]);

  const selTripRef = useRef(null);
  useEffect(() => { selTripRef.current = selTrip; }, [selTrip]);
  useEffect(() => {
    loadPins(); loadTrips(); loadMemDays();
    let ch = null;
    try {
      ch = client.channel("pp-map")
        .on("postgres_changes", { event: "*", schema: "public", table: "map_pins" }, () => loadPins())
        .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, () => loadTrips())
        .on("postgres_changes", { event: "*", schema: "public", table: "trip_stops" }, (p) => {
          const tid = (p.new && p.new.trip_id) || (p.old && p.old.trip_id);
          if (tid === selTripRef.current) loadStops(selTripRef.current);
        })
        .subscribe();
    } catch {}
    return () => { try { ch && client.removeChannel(ch); } catch {} };
  }, [client, loadPins, loadTrips, loadMemDays, loadStops]);

  useEffect(() => { loadStops(selTrip); }, [selTrip, loadStops]);
  useEffect(() => {
    let live = true;
    if (mode !== "trips" || stops.length < 1) { setRoute(null); return; }
    routeLine(stops).then((path) => { if (live) setRoute(path); });
    return () => { live = false; };
  }, [stops, mode]);

  // ---- actions ----
  const savePin = async () => {
    const f = pinSheet; if (!f.title.trim()) { flash("Name this place"); return; }
    const row = { lat: f.lat, lng: f.lng, title: f.title.trim(), note: (f.note || "").trim() || null, list: (f.list || DEFAULT_LIST).trim() || DEFAULT_LIST, emoji: f.emoji || "📍", visited: !!f.visited };
    const { error } = f.id ? await client.from("map_pins").update(row).eq("id", f.id) : await client.from("map_pins").insert({ ...row, created_by: me.id });
    if (error) { flash("⚠️ " + error.message); return; }
    setPinSheet(null); loadPins();
  };
  const deletePin = async () => { if (pinSheet.id) await client.from("map_pins").delete().eq("id", pinSheet.id); setPinSheet(null); loadPins(); };
  const togglePinVisited = async (p) => { await client.from("map_pins").update({ visited: !p.visited }).eq("id", p.id); loadPins(); };

  const saveStop = async () => {
    const f = stopSheet; if (!f.title.trim()) { flash("Name this stop"); return; }
    const row = { lat: f.lat, lng: f.lng, title: f.title.trim(), note: (f.note || "").trim() || null, visited: !!f.visited, seq: f.seq ?? stops.length };
    const { error } = f.id ? await client.from("trip_stops").update(row).eq("id", f.id) : await client.from("trip_stops").insert({ ...row, trip_id: f.trip_id });
    if (error) { flash("⚠️ " + error.message); return; }
    setStopSheet(null); loadStops(selTrip);
  };
  const deleteStop = async () => { if (stopSheet.id) await client.from("trip_stops").delete().eq("id", stopSheet.id); setStopSheet(null); loadStops(selTrip); };
  const toggleStopVisited = async (s) => { await client.from("trip_stops").update({ visited: !s.visited }).eq("id", s.id); loadStops(selTrip); };

  const createTrip = async () => {
    const t = (tripSheet.title || "").trim(); if (!t) { flash("Name the trip"); return; }
    const { data, error } = await client.from("trips").insert({ title: t, created_by: me.id }).select().single();
    if (error) { flash("⚠️ " + error.message); return; }
    setTripSheet(null); await loadTrips(); if (data) setSelTrip(data.id);
  };
  const deleteTrip = async (id) => {
    if (!confirm("Delete this trip and its stops?")) return;
    await client.from("trip_stops").delete().eq("trip_id", id);
    await client.from("trips").delete().eq("id", id);
    if (selTrip === id) setSelTrip(null);
    loadTrips();
  };

  // tapping the full-screen map while in "add" mode drops a pin / stop there
  const onMapTap = (latlng) => {
    if (!adding) return;
    const lat = +latlng.lat.toFixed(6), lng = +latlng.lng.toFixed(6);
    if (mode === "places") setPinSheet({ lat, lng, title: "", note: "", list: listFilter || DEFAULT_LIST, emoji: "📍", visited: false });
    else if (mode === "trips" && selTrip) setStopSheet({ trip_id: selTrip, lat, lng, title: "", note: "", seq: stops.length, visited: false });
    setAdding(false);
  };

  const openFull = (center, startAdding) => { setFullCenter(center || null); setAdding(!!startAdding); setFull(true); };
  const lists = useMemo(() => { const s = new Set([DEFAULT_LIST]); pins.forEach((p) => s.add(p.list)); return [...s]; }, [pins]);
  const visiblePins = pins.filter((p) => !listFilter || p.list === listFilter);
  const curTrip = trips.find((t) => t.id === selTrip);
  const hasAnything = pins.length || memDays.length || (mode === "trips" && stops.length);
  const modeBtn = (k, label) => html`<button class=${mode === k ? "on" : ""} onClick=${() => { setMode(k); setAdding(false); }}>${label}</button>`;

  // shared map props (the same data drives both the preview and the full map)
  const mapData = { mode, pins, memDays, stops, route, listFilter };

  return html`<div class="card mapcard">
    <div class="shead">
      <h2>Map <span class="muted-glyph">🗺️</span></h2>
      <div class="shead-actions">
        <button class="btn sm ghost" onClick=${() => openFull(null)}>⤢ Explore</button>
      </div>
    </div>

    <div class="seg map-modes">
      ${modeBtn("places", "📍 Places")}
      ${modeBtn("trips", "🚐 Road trips")}
      ${modeBtn("memories", "📸 Memories")}
    </div>

    <!-- preview: frozen (can't pan → never fights swipe-nav); tap to explore -->
    <div class="map-wrap preview">
      <${LeafletMap} interactive=${false} fitMode="always" ...${mapData} />
      <button class="map-open" onClick=${() => openFull(null)}>${hasAnything ? "" : html`<span class="map-open-empty">Tap to open the map</span>`}<span class="map-open-cta">⤢ Explore</span></button>
    </div>

    ${mode === "places" && html`<div class="map-panel">
      <div class="fchips">
        <button class=${`fchip ${!listFilter ? "on" : ""}`} onClick=${() => setListFilter(null)}>All</button>
        ${lists.map((l) => html`<button key=${l} class=${`fchip ${listFilter === l ? "on" : ""}`} onClick=${() => setListFilter(l)}>${l}</button>`)}
        <button class="fchip add" onClick=${() => openFull(null, true)}>＋ Pin</button>
      </div>
      ${visiblePins.length === 0
        ? html`<div class="map-empty">No places yet — ＋ Pin, then tap the map.</div>`
        : html`<div class="map-list">${visiblePins.map((p) => html`<button class="map-row" key=${p.id} onClick=${() => openFull({ lat: p.lat, lng: p.lng })}>
            <span class="mr-emoji">${p.emoji || "📍"}</span>
            <span class="mr-main"><span class=${`mr-title ${p.visited ? "done" : ""}`}>${p.title}</span><span class="mr-sub">${p.list}${p.note ? " · " + p.note : ""}</span></span>
            <span class=${`mr-check ${p.visited ? "on" : ""}`} role="button" onClick=${(e) => { e.stopPropagation(); togglePinVisited(p); }}>${p.visited ? "✓" : "○"}</span>
          </button>`)}</div>`}
    </div>`}

    ${mode === "trips" && html`<div class="map-panel">
      <div class="fchips">
        ${trips.map((t) => html`<button key=${t.id} class=${`fchip ${selTrip === t.id ? "on" : ""}`} onClick=${() => { setSelTrip(t.id); setAdding(false); }}>${t.emoji || "🚐"} ${t.title}</button>`)}
        <button class="fchip add" onClick=${() => setTripSheet({ title: "" })}>＋ New</button>
      </div>
      ${!selTrip
        ? html`<div class="map-empty">${trips.length ? "Pick a trip." : "No road trips yet — start one with ＋ New."}</div>`
        : html`<div class="trip-detail">
            <div class="trip-head"><span class="trip-name">${curTrip ? curTrip.title : ""}</span>
              <div class="trip-head-actions">
                <button class="btn sm" onClick=${() => openFull(null, true)}>＋ Stop</button>
                <button class="linkbtn danger" onClick=${() => deleteTrip(selTrip)}>Delete</button>
              </div></div>
            ${stops.length === 0
              ? html`<div class="map-empty">No stops yet — ＋ Stop, then tap the map.</div>`
              : html`<div class="map-list">${stops.map((s, i) => html`<button class="map-row" key=${s.id} onClick=${() => openFull({ lat: s.lat, lng: s.lng })}>
                  <span class=${`mr-seq ${s.visited ? "done" : ""}`}>${s.visited ? "✓" : i + 1}</span>
                  <span class="mr-main"><span class=${`mr-title ${s.visited ? "done" : ""}`}>${s.title}</span>${s.note ? html`<span class="mr-sub">${s.note}</span>` : ""}</span>
                  <span class=${`mr-check ${s.visited ? "on" : ""}`} role="button" onClick=${(e) => { e.stopPropagation(); toggleStopVisited(s); }}>${s.visited ? "been" : "plan"}</span>
                </button>`)}</div>`}
          </div>`}
    </div>`}

    ${mode === "memories" && html`<div class="map-panel">
      ${memDays.length === 0
        ? html`<div class="map-empty">Geotagged photo days show up here automatically.</div>`
        : html`<div class="map-list">${memDays.map((d) => html`<button class="map-row" key=${d.date} onClick=${() => openFull({ lat: d.lat, lng: d.lng })}>
            <span class="mr-emoji">📸</span>
            <span class="mr-main"><span class="mr-title">${d.place || "A day together"}</span><span class="mr-sub">${fmtDay(d.date)} · ${d.count} ${d.count === 1 ? "photo" : "photos"}</span></span>
          </button>`)}</div>`}
    </div>`}

    ${full && createPortal(html`<div class="mapfull">
      <div class="mapfull-bar">
        <button class="vw-x" onClick=${() => { setFull(false); setAdding(false); }}>✕</button>
        <div class="seg map-modes mf-modes">
          ${modeBtn("places", "📍")}
          ${modeBtn("trips", "🚐")}
          ${modeBtn("memories", "📸")}
        </div>
        ${(mode === "places" || (mode === "trips" && selTrip)) && html`<button class=${`btn sm ${adding ? "" : "ghost"}`} onClick=${() => setAdding((a) => !a)}>${adding ? "Tap to place" : (mode === "places" ? "＋ Pin" : "＋ Stop")}</button>`}
      </div>
      <div class=${`mapfull-map ${adding ? "adding" : ""}`}>
        <${LeafletMap} interactive=${true} fitMode="once" initialCenter=${fullCenter} ...${mapData}
          onMapClick=${onMapTap} onPinClick=${(p) => setPinSheet({ ...p })} onStopClick=${(s) => setStopSheet({ ...s })} />
        ${adding && html`<div class="map-hint">Tap to place</div>`}
        ${mode === "trips" && !selTrip && html`<div class="mf-note">Pick a trip below to plan stops.</div>`}
      </div>
    </div>`, document.body)}

    ${pinSheet && html`<${PinSheet} f=${pinSheet} setF=${setPinSheet} lists=${lists} onSave=${savePin} onDelete=${deletePin} />`}
    ${stopSheet && html`<${StopSheet} f=${stopSheet} setF=${setStopSheet} onSave=${saveStop} onDelete=${deleteStop} />`}
    ${tripSheet && html`<div class="modal-bg asheet" onClick=${(e) => { if (e.target.classList.contains("modal-bg")) setTripSheet(null); }}>
      <div class="modal">
        <div class="handle"></div>
        <div class="eyebrow" style="margin-bottom:10px">🚐 new road trip</div>
        <input autofocus value=${tripSheet.title} onInput=${(e) => setTripSheet({ title: e.target.value })} placeholder="Pacific Coast Highway…" />
        <button class="btn block mt" onClick=${createTrip}>Start trip</button>
        <button class="linkbtn block mt" style="width:100%" onClick=${() => setTripSheet(null)}>Cancel</button>
      </div>
    </div>`}
  </div>`;
}

const EMOJI = ["📍", "❤️", "🍝", "🏖️", "⛰️", "🏛️", "🎡", "☕", "🍷", "🏕️", "🌃", "✈️"];

function PinSheet({ f, setF, lists, onSave, onDelete }) {
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return html`<div class="modal-bg asheet" onClick=${(e) => { if (e.target.classList.contains("modal-bg")) setF(null); }}>
    <div class="modal">
      <div class="handle"></div>
      <div class="eyebrow" style="margin-bottom:10px">${f.id ? "📍 place" : "📍 new place"}</div>
      <input autofocus value=${f.title} onInput=${up("title")} placeholder="Name this place…" />
      <div class="emoji-row mt">${EMOJI.map((e) => html`<button key=${e} class=${`emoji-pick ${f.emoji === e ? "on" : ""}`} onClick=${() => setF({ ...f, emoji: e })}>${e}</button>`)}</div>
      <input class="mt" list="pp-lists" value=${f.list} onInput=${up("list")} placeholder="List" />
      <datalist id="pp-lists">${lists.map((l) => html`<option key=${l} value=${l}></option>`)}</datalist>
      <input class="mt" value=${f.note || ""} onInput=${up("note")} placeholder="Note (optional)…" />
      <label class="map-toggle mt"><input type="checkbox" checked=${!!f.visited} onChange=${(e) => setF({ ...f, visited: e.target.checked })} /> <span>We've been here</span></label>
      <button class="btn block mt" onClick=${onSave}>${f.id ? "Save" : "Drop pin"}</button>
      ${f.id && html`<button class="btn ghost block mt" style="color:var(--bad);border-color:var(--bad)" onClick=${onDelete}>Delete</button>`}
      <button class="linkbtn block mt" style="width:100%" onClick=${() => setF(null)}>Cancel</button>
    </div>
  </div>`;
}

function StopSheet({ f, setF, onSave, onDelete }) {
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return html`<div class="modal-bg asheet" onClick=${(e) => { if (e.target.classList.contains("modal-bg")) setF(null); }}>
    <div class="modal">
      <div class="handle"></div>
      <div class="eyebrow" style="margin-bottom:10px">${f.id ? "📌 stop" : "📌 new stop"}</div>
      <input autofocus value=${f.title} onInput=${up("title")} placeholder="Where are we stopping?" />
      <input class="mt" value=${f.note || ""} onInput=${up("note")} placeholder="Note (optional)…" />
      <label class="map-toggle mt"><input type="checkbox" checked=${!!f.visited} onChange=${(e) => setF({ ...f, visited: e.target.checked })} /> <span>We've been here</span></label>
      <button class="btn block mt" onClick=${onSave}>${f.id ? "Save" : "Add stop"}</button>
      ${f.id && html`<button class="btn ghost block mt" style="color:var(--bad);border-color:var(--bad)" onClick=${onDelete}>Remove stop</button>`}
      <button class="linkbtn block mt" style="width:100%" onClick=${() => setF(null)}>Cancel</button>
    </div>
  </div>`;
}

function fmtDay(d) {
  try { return new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return d; }
}
