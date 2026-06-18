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

// Curated "things to do" — a Timeout-style mix of iconic + romantic spots. No
// scraping/keys (this repo is public); each carries a geocode query so one tap
// resolves real coordinates and drops it into "Places We Want to Go".
const SUGGESTIONS = [
  { emoji: "🌉", name: "Brooklyn Bridge Park", blurb: "Skyline picnics at golden hour", q: "Brooklyn Bridge Park, New York" },
  { emoji: "🌃", name: "Top of the Rock", blurb: "The skyline's best seat", q: "Top of the Rock, New York" },
  { emoji: "📚", name: "Strand Book Store", blurb: "18 miles of books to get lost in", q: "Strand Book Store, New York" },
  { emoji: "🦪", name: "Grand Central Oyster Bar", blurb: "Oysters under the vaulted tiles", q: "Grand Central Oyster Bar, New York" },
  { emoji: "🌲", name: "The Ramble, Central Park", blurb: "Get pleasantly lost together", q: "The Ramble, Central Park, New York" },
  { emoji: "🎡", name: "Coney Island", blurb: "Boardwalk rides & hot dogs", q: "Coney Island, New York" },
  { emoji: "🌊", name: "Rockaway Beach", blurb: "Surf, tacos, sand", q: "Rockaway Beach, New York" },
  { emoji: "🖼️", name: "The Met", blurb: "Lose an afternoon in art", q: "Metropolitan Museum of Art, New York" },
  { emoji: "🌉", name: "Golden Gate Bridge", blurb: "Bike across the bay", q: "Golden Gate Bridge, San Francisco" },
  { emoji: "⛰️", name: "Big Sur", blurb: "Cliffs, fog, the open road", q: "Big Sur, California" },
  { emoji: "🌮", name: "Grand Central Market", blurb: "A hundred cravings, one roof", q: "Grand Central Market, Los Angeles" },
  { emoji: "🗼", name: "Eiffel Tower", blurb: "Champagne on the Champ de Mars", q: "Eiffel Tower, Paris" },
  { emoji: "🥐", name: "Le Marais", blurb: "Wander, pastries, repeat", q: "Le Marais, Paris" },
  { emoji: "🏛️", name: "Trastevere", blurb: "Cobblestones & carbonara", q: "Trastevere, Rome" },
  { emoji: "🌅", name: "Oia, Santorini", blurb: "Caldera sunsets", q: "Oia, Santorini, Greece" },
  { emoji: "🏮", name: "Gion, Kyoto", blurb: "Lantern-lit old streets", q: "Gion, Kyoto, Japan" },
];

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

// Free, key-less place/address search (Photon by komoot — built for autocomplete,
// CORS-friendly). Returns a short list of {name, label, lat, lng}.
async function geocode(q) {
  try {
    const r = await fetch(`https://photon.komoot.io/api/?limit=6&lang=en&q=${encodeURIComponent(q)}`);
    const j = await r.json();
    return (j.features || []).map((f) => {
      const p = f.properties || {}, c = (f.geometry || {}).coordinates || [];
      const label = [p.name, p.street && !p.name ? p.street : null, p.city || p.county, p.state, p.country].filter(Boolean).join(", ");
      return { name: p.name || (label.split(",")[0]) || q, label: label || q, lat: c[1], lng: c[0] };
    }).filter((r) => isFinite(r.lat) && isFinite(r.lng));
  } catch { return []; }
}

const pinIcon = (L, emoji, visited) => L.divIcon({ className: "mkr", html: `<div class="mkr-pin ${visited ? "done" : ""}">${emoji || "📍"}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
const memIcon = (L) => L.divIcon({ className: "mkr", html: `<div class="mkr-pin mem">📸</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
const stopIcon = (L, n, visited) => L.divIcon({ className: "mkr", html: `<div class="mkr-stop ${visited ? "done" : ""}">${visited ? "✓" : n}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });

// A self-contained Leaflet map. interactive=false → a frozen preview (can't pan,
// so it never steals the swipe-nav gesture). fitMode "always" refits on every
// data change (preview); "once" fits a single time on open (full-screen).
function LeafletMap({ interactive, fitMode, initialCenter, focus, pending, mode, pins, memDays, stops, route, listFilter, onMapClick, onPinClick, onStopClick }) {
  const elRef = useRef(null), mapRef = useRef(null), layerRef = useRef(null), LRef = useRef(null), clickRef = useRef(() => {});
  const pendRef = useRef(null), pendKey = useRef("");
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

  // runtime fly-to (a list row tapped) — after mount, so it won't fight the fit
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus) return;
    try { map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 13), { duration: .6 }); } catch {}
  }, [focus, ready]);

  // a PROVISIONAL marker for a pin/stop being confirmed — so you see exactly
  // where it'll land. Recenter only when the location changes (not while you
  // edit the title/emoji), and lift it above the bottom sheet so it stays visible.
  useEffect(() => {
    const map = mapRef.current, L = LRef.current;
    if (!ready || !map || !L) return;
    if (pendRef.current) { try { map.removeLayer(pendRef.current); } catch {} pendRef.current = null; }
    if (!pending) { pendKey.current = ""; return; }
    const icon = L.divIcon({ className: "mkr", html: `<div class="mkr-pending">${pending.emoji || "📍"}</div>`, iconSize: [38, 38], iconAnchor: [19, 19] });
    pendRef.current = L.marker([pending.lat, pending.lng], { icon, zIndexOffset: 1000, interactive: false }).addTo(map);
    const key = pending.lat + "," + pending.lng;
    if (key !== pendKey.current) {
      pendKey.current = key;
      // center ~150px BELOW the marker so it sits in the upper map, clear of the
      // bottom confirm sheet (project→shift→unproject = deterministic offset).
      try {
        const z = Math.max(map.getZoom(), 14);
        const c = map.unproject(map.project([pending.lat, pending.lng], z).add([0, 150]), z);
        map.setView(c, z, { animate: true });
      } catch {}
    }
  }, [pending && pending.lat, pending && pending.lng, pending && pending.emoji, ready]);

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
  const [mode, setMode] = useState("memories");
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
  const [sugBusy, setSugBusy] = useState(-1);         // suggestion being added
  const [query, setQuery] = useState("");             // place/address search
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [focus, setFocus] = useState(null);           // {lat,lng,nonce} → full map flies here
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
    // pull each day's AI chapter title so the list reads as a journey, not the
    // same city name repeated.
    const days = [...byDay.keys()];
    if (days.length) {
      const { data: st } = await client.from("day_stories").select("day,title").in("day", days);
      (st || []).forEach((s) => { const g = byDay.get(s.day); if (g && s.title) g.title = s.title; });
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

  // one-tap add a curated suggestion → geocode → drop into "Places We Want to Go"
  const addSuggestion = async (s, i) => {
    setSugBusy(i);
    const res = await geocode(s.q);
    const hit = res[0];
    if (!hit) { setSugBusy(-1); flash("Couldn't place that one — try the map search"); return; }
    const { error } = await client.from("map_pins").insert({ lat: hit.lat, lng: hit.lng, title: s.name, list: DEFAULT_LIST, emoji: s.emoji, note: s.blurb || null, visited: false, created_by: me.id });
    setSugBusy(-1);
    if (error) { flash("⚠️ " + error.message); return; }
    flash(`Added ${s.emoji} ${s.name}`);
    setListFilter(null); loadPins();
  };

  const openFull = (center, startAdding) => { setFullCenter(center || null); setAdding(!!startAdding); setQuery(""); setResults([]); setFocus(null); setFull(true); };
  const closeFull = () => { setFull(false); setAdding(false); setQuery(""); setResults([]); };

  // debounced place search while the full map is open
  useEffect(() => {
    if (!full) return;
    const q = query.trim();
    if (q.length < 3) { setResults([]); setSearching(false); return; }
    let live = true; setSearching(true);
    const t = setTimeout(async () => { const res = await geocode(q); if (live) { setResults(res); setSearching(false); } }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [query, full]);

  // picking a search result ALWAYS drops a provisional pin to confirm/rename
  // (searching means you want to save it). Memories / no-trip → just fly.
  const onSearchPick = (r) => {
    setQuery(""); setResults([]); setAdding(false);
    if (mode === "places") setPinSheet({ lat: r.lat, lng: r.lng, title: r.name, note: "", list: listFilter || DEFAULT_LIST, emoji: "📍", visited: false });
    else if (mode === "trips" && selTrip) setStopSheet({ trip_id: selTrip, lat: r.lat, lng: r.lng, title: r.name, note: "", seq: stops.length, visited: false });
    else setFocus({ lat: r.lat, lng: r.lng, nonce: Date.now() });
  };
  const lists = useMemo(() => { const s = new Set([DEFAULT_LIST]); pins.forEach((p) => s.add(p.list)); return [...s]; }, [pins]);
  const visiblePins = pins.filter((p) => !listFilter || p.list === listFilter);
  const curTrip = trips.find((t) => t.id === selTrip);
  const hasAnything = pins.length || memDays.length || (mode === "trips" && stops.length);
  const modeBtn = (k, label) => html`<button class=${mode === k ? "on" : ""} onClick=${() => { setMode(k); setAdding(false); }}>${label}</button>`;

  // shared map props (the same data drives both the preview and the full map)
  const mapData = { mode, pins, memDays, stops, route, listFilter };
  // a NEW pin/stop awaiting confirmation → show a provisional marker on the map
  const pending = (pinSheet && !pinSheet.id) ? { lat: pinSheet.lat, lng: pinSheet.lng, emoji: pinSheet.emoji || "📍" }
    : (stopSheet && !stopSheet.id) ? { lat: stopSheet.lat, lng: stopSheet.lng, emoji: "📌" } : null;

  // tapping a row: in full-screen → fly there; on the card → open full-screen there
  const rowGo = (inFull, lat, lng) => inFull ? setFocus({ lat, lng, nonce: Date.now() }) : openFull({ lat, lng });
  // the add toggle: in full-screen → arm tap/search; on the card → open full + arm
  const startAdd = (inFull) => inFull ? setAdding((a) => !a) : openFull(null, true);

  // One panel definition used in BOTH the card and the full-screen drawer, so the
  // whole add/remove/manage workflow lives wherever you are (no bouncing back).
  const panel = (inFull) => {
    if (mode === "places") return html`<div class="map-panel">
      <div class="fchips">
        <button class=${`fchip ${!listFilter ? "on" : ""}`} onClick=${() => setListFilter(null)}>All</button>
        ${lists.map((l) => html`<button key=${l} class=${`fchip ${listFilter === l ? "on" : ""}`} onClick=${() => setListFilter(l)}>${l}</button>`)}
        <button class=${`fchip add ${inFull && adding ? "on" : ""}`} onClick=${() => startAdd(inFull)}>${inFull && adding ? "Tap map" : "＋ Pin"}</button>
      </div>
      ${visiblePins.length === 0
        ? html`<div class="map-empty">No places yet — ＋ Pin, then ${inFull ? "search or tap the map" : "open the map"}.</div>`
        : html`<div class="map-list">${visiblePins.map((p) => html`<div class="map-row" role="button" key=${p.id} onClick=${() => rowGo(inFull, p.lat, p.lng)}>
            <span class="mr-emoji">${p.emoji || "📍"}</span>
            <span class="mr-main"><span class=${`mr-title ${p.visited ? "done" : ""}`}>${p.title}</span><span class="mr-sub">${p.list}${p.note ? " · " + p.note : ""}</span></span>
            <span class=${`mr-check ${p.visited ? "on" : ""}`} role="button" onClick=${(e) => { e.stopPropagation(); togglePinVisited(p); }}>${p.visited ? "✓" : "○"}</span>
            <span class="mr-edit" role="button" onClick=${(e) => { e.stopPropagation(); setPinSheet({ ...p }); }}>⋯</span>
          </div>`)}</div>`}
    </div>`;

    if (mode === "trips") return html`<div class="map-panel">
      <div class="fchips">
        ${trips.map((t) => html`<button key=${t.id} class=${`fchip ${selTrip === t.id ? "on" : ""}`} onClick=${() => { setSelTrip(t.id); setAdding(false); }}>${t.emoji || "🚐"} ${t.title}</button>`)}
        <button class="fchip add" onClick=${() => setTripSheet({ title: "" })}>＋ New</button>
      </div>
      ${!selTrip
        ? html`<div class="map-empty">${trips.length ? "Pick a trip." : "No road trips yet — start one with ＋ New."}</div>`
        : html`<div class="trip-detail">
            <div class="trip-head"><span class="trip-name">${curTrip ? curTrip.title : ""}</span>
              <div class="trip-head-actions">
                <button class=${`btn sm ${inFull && adding ? "" : "ghost"}`} onClick=${() => startAdd(inFull)}>${inFull && adding ? "Tap map" : "＋ Stop"}</button>
                <button class="linkbtn danger" onClick=${() => deleteTrip(selTrip)}>Delete</button>
              </div></div>
            ${stops.length === 0
              ? html`<div class="map-empty">No stops yet — ＋ Stop, then ${inFull ? "search or tap the map" : "open the map"}.</div>`
              : html`<div class="map-list">${stops.map((s, i) => html`<div class="map-row" role="button" key=${s.id} onClick=${() => rowGo(inFull, s.lat, s.lng)}>
                  <span class=${`mr-seq ${s.visited ? "done" : ""}`}>${s.visited ? "✓" : i + 1}</span>
                  <span class="mr-main"><span class=${`mr-title ${s.visited ? "done" : ""}`}>${s.title}</span>${s.note ? html`<span class="mr-sub">${s.note}</span>` : ""}</span>
                  <span class=${`mr-check ${s.visited ? "on" : ""}`} role="button" onClick=${(e) => { e.stopPropagation(); toggleStopVisited(s); }}>${s.visited ? "been" : "plan"}</span>
                  <span class="mr-edit" role="button" onClick=${(e) => { e.stopPropagation(); setStopSheet({ ...s }); }}>⋯</span>
                </div>`)}</div>`}
          </div>`}
    </div>`;

    return html`<div class="map-panel">
      ${memDays.length === 0
        ? html`<div class="map-empty">Geotagged photo days show up here automatically.</div>`
        : html`<div class="map-list">${memDays.map((d) => {
            const sub = [d.title && d.place ? d.place : null, fmtDay(d.date), `${d.count} ${d.count === 1 ? "photo" : "photos"}`].filter(Boolean).join(" · ");
            return html`<div class="map-row" role="button" key=${d.date} onClick=${() => rowGo(inFull, d.lat, d.lng)}>
              <span class="mr-emoji">📸</span>
              <span class="mr-main"><span class="mr-title">${d.title || d.place || "A day together"}</span><span class="mr-sub">${sub}</span></span>
            </div>`; })}</div>`}
    </div>`;
  };

  return html`<div class="card mapcard">
    <div class="shead">
      <h2>Map <span class="muted-glyph">🗺️</span></h2>
    </div>

    <div class="seg map-modes">
      ${modeBtn("memories", "📸 Memories")}
      ${modeBtn("places", "📍 Places")}
      ${modeBtn("trips", "🚐 Trips")}
    </div>

    <!-- preview: frozen (can't pan → never fights swipe-nav); tap to explore -->
    <div class="map-wrap preview">
      <${LeafletMap} interactive=${false} fitMode="always" ...${mapData} />
      <button class="map-open" onClick=${() => openFull(null)}>${hasAnything ? "" : html`<span class="map-open-empty">Tap to open the map</span>`}<span class="map-open-cta">⤢ Explore</span></button>
    </div>

    ${mode === "places" && html`<${Suggestions} onAdd=${addSuggestion} busy=${sugBusy} />`}

    ${panel(false)}

    ${full && createPortal(html`<div class="mapfull">
      <div class="mapfull-bar">
        <button class="vw-x" onClick=${closeFull}>✕</button>
        <div class="seg map-modes mf-modes">
          ${modeBtn("memories", "📸")}
          ${modeBtn("places", "📍")}
          ${modeBtn("trips", "🚐")}
        </div>
      </div>
      ${mode !== "memories" && html`<div class="mapsearch">
        <span class="ms-ico">🔍</span>
        <input value=${query} onInput=${(e) => setQuery(e.target.value)} placeholder=${adding ? (mode === "trips" ? "Search a stop — place or address…" : "Search a place or address…") : "Search the map…"} autocomplete="off" />
        ${query && html`<button class="ms-clear" onClick=${() => { setQuery(""); setResults([]); }}>✕</button>`}
        ${(results.length > 0 || searching) && html`<div class="mapsearch-results">
          ${searching && results.length === 0 ? html`<div class="ms-row muted">Searching…</div>`
            : results.map((r, i) => html`<button class="ms-row" key=${i} onClick=${() => onSearchPick(r)}>
                <span class="ms-pin">📍</span><span class="ms-label">${r.label}</span></button>`)}
        </div>`}
      </div>`}
      <div class=${`mapfull-map ${adding ? "adding" : ""}`}>
        <${LeafletMap} interactive=${true} fitMode="once" initialCenter=${fullCenter} focus=${focus} pending=${pending} ...${mapData}
          onMapClick=${onMapTap} onPinClick=${(p) => setPinSheet({ ...p })} onStopClick=${(s) => setStopSheet({ ...s })} />
        ${adding && html`<div class="map-hint">Search above, or tap the map</div>`}
      </div>
      <div class="mapfull-panel">${panel(true)}</div>
    </div>`, document.body)}

    <!-- sheets portal to <body> so they sit ABOVE the full-screen map (z46) and
         aren't clipped/trapped by the glass card's backdrop-filter -->
    ${pinSheet && createPortal(html`<${PinSheet} f=${pinSheet} setF=${setPinSheet} lists=${lists} onSave=${savePin} onDelete=${deletePin} />`, document.body)}
    ${stopSheet && createPortal(html`<${StopSheet} f=${stopSheet} setF=${setStopSheet} onSave=${saveStop} onDelete=${deleteStop} />`, document.body)}
    ${tripSheet && createPortal(html`<div class="modal-bg asheet" onClick=${(e) => { if (e.target.classList.contains("modal-bg")) setTripSheet(null); }}>
      <div class="modal">
        <div class="handle"></div>
        <div class="eyebrow" style="margin-bottom:10px">🚐 new road trip</div>
        <input autofocus value=${tripSheet.title} onInput=${(e) => setTripSheet({ title: e.target.value })} placeholder="Pacific Coast Highway…" />
        <button class="btn block mt" onClick=${createTrip}>Start trip</button>
        <button class="linkbtn block mt" style="width:100%" onClick=${() => setTripSheet(null)}>Cancel</button>
      </div>
    </div>`, document.body)}
  </div>`;
}

// Auto-rotating, swipeable "ideas" strip → one tap adds to the wishlist.
function Suggestions({ onAdd, busy }) {
  const ref = useRef(null), paused = useRef(false), resume = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const id = setInterval(() => {
      if (paused.current || !el.isConnected) return;
      const card = el.querySelector(".sug-card");
      const step = card ? card.offsetWidth + 12 : 240;
      if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 8) el.scrollTo({ left: 0, behavior: "smooth" });
      else el.scrollBy({ left: step, behavior: "smooth" });
    }, 4500);
    return () => clearInterval(id);
  }, []);
  const hold = () => { paused.current = true; clearTimeout(resume.current); resume.current = setTimeout(() => { paused.current = false; }, 9000); };
  return html`<div class="sugwrap" data-noswipe>
    <div class="sug-eyebrow">Ideas for your list ✨</div>
    <div class="sugstrip" ref=${ref} onPointerDown=${hold}>
      ${SUGGESTIONS.map((s, i) => html`<div class="sug-card" key=${i}>
        <span class="sug-emoji">${s.emoji}</span>
        <div class="sug-main"><div class="sug-name">${s.name}</div><div class="sug-blurb">${s.blurb}</div></div>
        <button class="sug-add" disabled=${busy === i} onClick=${() => onAdd(s, i)}>${busy === i ? "…" : "＋"}</button>
      </div>`)}
    </div>
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
