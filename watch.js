import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useMemo, useRef, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { createPortal } from "https://esm.sh/preact@10.23.2/compat";
import { notifyTurn } from "./push.js";

const html = htm.bind(h);
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

/* 📺 Shared Social Queue
   - SHARE: send a social link one-way to your partner; the loop closes with a
     "seen" receipt + their emoji reactions / comment.
   - QUEUE: a together-watch list that stays hidden until BOTH tap Ready, then
     plays in order. Viewer is HYBRID: YouTube auto-advances; TikTok embeds
     inline (tap Next); Reels/others show a card you tap to open. */

const PLAT = {
  tiktok:    { icon: "🎵", label: "TikTok" },
  instagram: { icon: "📸", label: "Instagram" },
  youtube:   { icon: "▶️", label: "YouTube" },
  twitter:   { icon: "𝕏", label: "X" },
  other:     { icon: "🔗", label: "Link" },
};
const REACTS = ["😂", "😍", "😱", "🔥", "🥹", "💀", "👀", "💗"];

function parseLink(raw) {
  const s = (raw || "").trim();
  let u; try { u = new URL(s); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const path = u.pathname;
  const mk = (platform, video_id) => ({ platform, video_id, url: s });
  if (host === "youtu.be") return mk("youtube", path.slice(1).split("/")[0] || null);
  if (host.endsWith("youtube.com")) {
    if (path.startsWith("/shorts/")) return mk("youtube", path.split("/")[2] || null);
    if (path.startsWith("/embed/")) return mk("youtube", path.split("/")[2] || null);
    const v = u.searchParams.get("v"); if (v) return mk("youtube", v);
    return mk("youtube", null);
  }
  if (host.endsWith("tiktok.com")) { const m = path.match(/\/video\/(\d+)/); return mk("tiktok", m ? m[1] : null); }
  if (host.endsWith("instagram.com")) { const m = path.match(/\/(reel|reels|p|tv)\/([^/]+)/); return mk("instagram", m ? m[2] : null); }
  if (host === "x.com" || host.endsWith("twitter.com")) { const m = path.match(/\/status\/(\d+)/); return mk("twitter", m ? m[1] : null); }
  return mk("other", null);
}
const ytThumb = (it) => (it.platform === "youtube" && it.video_id) ? `https://i.ytimg.com/vi/${it.video_id}/hqdefault.jpg` : null;

// lazy-load the YouTube IFrame API once (only platform with real queue control)
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

const ago = (iso) => {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
};

/* --------------------------------------------------------- viewer --------- */
function Viewer({ items, index, me, onClose, onNav, onReact }) {
  const it = items[index];
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") onNav(index + 1); if (e.key === "ArrowLeft") onNav(index - 1); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, onClose, onNav]);

  // YouTube → autoplay + auto-advance on ENDED
  useEffect(() => {
    if (!it || it.platform !== "youtube" || !it.video_id) return;
    let player, dead = false;
    loadYT().then((YT) => {
      if (dead || !YT) return;
      try {
        player = new YT.Player(`yt-${it.id}`, {
          videoId: it.video_id,
          playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
          events: { onStateChange: (e) => { if (e.data === YT.PlayerState.ENDED) onNav(index + 1); } },
        });
      } catch {}
    });
    return () => { dead = true; try { player && player.destroy(); } catch {} };
  }, [it && it.id]);

  if (!it) return null;
  const meta = PLAT[it.platform] || PLAT.other;
  const myReacts = (it.reactions || []).filter((r) => r.by === me.id).map((r) => r.emoji);
  const stage = it.platform === "youtube" && it.video_id
    ? html`<div class="vw-embed"><div id=${`yt-${it.id}`}></div></div>`
    : it.platform === "tiktok" && it.video_id
      ? html`<div class="vw-embed tall"><iframe src=${`https://www.tiktok.com/embed/v2/${it.video_id}`} allow="autoplay; encrypted-media; fullscreen" allowfullscreen frameborder="0"></iframe></div>`
      : html`<div class="vw-openpane">
          <div class="vw-bigicon">${meta.icon}</div>
          <div class="vw-pl">${meta.label}${it.platform === "instagram" ? " Reel" : ""}</div>
          <a class="btn" href=${it.url} target="_blank" rel="noopener">Open ↗</a>
        </div>`;

  return createPortal(html`<div class="viewer">
    <div class="vw-bar">
      <button class="vw-x" onClick=${onClose}>‹</button>
      <span class="vw-addr">${meta.icon} ${hostOf(it.url) || meta.label}</span>
      <span class="vw-count">${index + 1} / ${items.length}</span>
    </div>
    <div class="vw-stage">${stage}</div>
    ${it.note ? html`<div class="vw-note">“${it.note}”</div>` : ""}
    <div class="vw-react">
      ${REACTS.map((e) => html`<button key=${e} class=${myReacts.includes(e) ? "on" : ""} onClick=${() => onReact(it, e)}>${e}</button>`)}
    </div>
    <div class="vw-nav">
      <button class="btn ghost" disabled=${index === 0} onClick=${() => onNav(index - 1)}>‹ Prev</button>
      <button class="btn" disabled=${index >= items.length - 1} onClick=${() => onNav(index + 1)}>Next ▶</button>
    </div>
  </div>`, document.body);
}

/* ----------------------------------------------------------- tab ---------- */
export function WatchTab({ client, me, players, flash }) {
  const partner = players.find((p) => p.id !== me.id) || players[0];
  const [items, setItems] = useState(null);
  const [watch, setWatch] = useState(null);          // watch_state row
  const [view, setView] = useState("shares");        // 'shares' | 'queue'
  const [input, setInput] = useState("");
  const [note, setNote] = useState("");
  const [viewer, setViewer] = useState(null);        // { list, index }

  const load = useCallback(async () => {
    const [{ data: links }, { data: ws }] = await Promise.all([
      client.from("social_links").select("*").eq("status", "active").order("created_at", { ascending: false }),
      client.from("watch_state").select("*").order("updated_at", { ascending: false }).limit(1),
    ]);
    setItems(links || []);
    setWatch((ws && ws[0]) || null);
  }, [client]);

  useEffect(() => {
    load();
    let ch = null;
    try {
      ch = client.channel("pp-watch")
        .on("postgres_changes", { event: "*", schema: "public", table: "social_links" }, () => load())
        .on("postgres_changes", { event: "*", schema: "public", table: "watch_state" }, () => load())
        .subscribe();
    } catch {}
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    return () => { document.removeEventListener("visibilitychange", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load]);

  const parsed = useMemo(() => parseLink(input), [input]);

  const add = async (mode) => {
    const p = parseLink(input);
    if (!p) { flash("Paste a valid link"); return; }
    const rowBase = { url: p.url, platform: p.platform, video_id: p.video_id, mode, sender_id: me.id, note: note.trim() || null };
    if (mode === "share") rowBase.recipient_id = partner.id;
    const { error } = await client.from("social_links").insert(rowBase);
    if (error) { flash("⚠️ " + error.message); return; }
    setInput(""); setNote("");
    if (mode === "share") {
      notifyTurn(client, partner.id, `🎬 ${me.emoji} ${me.name} sent you a video`, p.note || (PLAT[p.platform] || PLAT.other).label);
      flash(`Sent to ${partner.emoji} ${partner.name} ✓`);
    } else flash("Added to the queue 🍿");
    load();
  };

  const del = async (it) => { await client.from("social_links").delete().eq("id", it.id); load(); };

  const markSeen = useCallback(async (it) => {
    if (it.recipient_id === me.id && !it.seen_at) {
      await client.from("social_links").update({ seen_at: new Date().toISOString() }).eq("id", it.id);
      notifyTurn(client, it.sender_id, `👀 ${me.emoji} ${me.name} watched your video`, "Tap to see their reaction");
      load();
    }
  }, [client, me, load]);

  const react = useCallback(async (it, emoji) => {
    const list = (it.reactions || []).filter((r) => r.by !== me.id);     // one reaction per person per item
    const mine = (it.reactions || []).find((r) => r.by === me.id);
    const next = mine && mine.emoji === emoji ? list : [...list, { by: me.id, emoji, at: new Date().toISOString() }];
    await client.from("social_links").update({ reactions: next }).eq("id", it.id);
    // tell the sender of a share that their partner reacted
    if (it.mode === "share" && it.sender_id !== me.id) notifyTurn(client, it.sender_id, `${emoji} ${me.emoji} ${me.name} reacted`, "to the video you sent");
    setItems((cur) => (cur || []).map((x) => x.id === it.id ? { ...x, reactions: next } : x));
  }, [client, me]);

  // ---- mutual-ready gate for the queue (shared via watch_state) ----
  const ready = (watch && watch.state && watch.state.ready) || {};
  const bothReady = players.every((p) => ready[p.id]);
  const meReady = !!ready[me.id];
  const setReady = async (val) => {
    for (let i = 0; i < 3; i++) {
      const { data } = await client.from("watch_state").select("*").order("updated_at", { ascending: false }).limit(1);
      let row = data && data[0];
      if (!row) { const ins = await client.from("watch_state").insert({ state: { ready: {} } }).select().single(); row = ins.data; }
      const nextReady = { ...((row.state && row.state.ready) || {}), [me.id]: val };
      const { data: upd, error } = await client.from("watch_state")
        .update({ state: { ...row.state, ready: nextReady }, version: row.version + 1, updated_at: new Date().toISOString() })
        .eq("id", row.id).eq("version", row.version).select();
      if (!error && upd && upd.length) { setWatch(upd[0]); return; }
    }
  };

  const queueItems = (items || []).filter((i) => i.mode === "queue").slice().reverse();   // oldest first → watch order
  const finishQueue = async () => {
    await client.from("social_links").update({ status: "watched" }).eq("mode", "queue").eq("status", "active");
    await setReady(false);
    flash("Queue cleared 🍿");
    setViewer(null); load();
  };

  // shared lists
  const forMe = (items || []).filter((i) => i.mode === "share" && i.recipient_id === me.id);
  const sent = (items || []).filter((i) => i.mode === "share" && i.sender_id === me.id);
  const unseenForMe = forMe.filter((i) => !i.seen_at).length;

  const openViewer = (list, idx) => { setViewer({ list, index: idx }); const it = list[idx]; if (it) markSeen(it); };
  const navViewer = (i) => setViewer((v) => {
    if (!v) return v;
    if (i < 0 || i >= v.list.length) return null;     // past the end → close
    markSeen(v.list[i]); return { ...v, index: i };
  });

  const Card = (it, opts = {}) => {
    const meta = PLAT[it.platform] || PLAT.other;
    const th = ytThumb(it);
    const senders = players.find((p) => p.id === it.sender_id);
    const rx = it.reactions || [];
    return html`<button class="wcard" key=${it.id} onClick=${() => opts.onOpen && opts.onOpen()}>
      <div class=${`wthumb ${it.platform}`}>${th ? html`<img src=${th} alt="" loading="lazy" />` : html`<span class="wicon">${meta.icon}</span>`}<span class="wplay">▶</span></div>
      <div class="wmeta">
        <div class="wtitle">${meta.icon} ${meta.label}${opts.unseen ? html`<span class="wdot"></span>` : ""}</div>
        ${it.note ? html`<div class="wnote">“${it.note}”</div>` : ""}
        <div class="tiny muted wsub">${opts.sub}</div>
        ${rx.length > 0 && html`<div class="wrx">${rx.map((r) => html`<span key=${r.by} title=${ago(r.at)}>${r.emoji}</span>`)}</div>`}
      </div>
      ${opts.canDelete && html`<span class="wdel" role="button" onClick=${(e) => { e.stopPropagation(); del(it); }}>✕</span>`}
    </button>`;
  };

  return html`<div class="card">
    <div class="shead"><h2>Watch <span class="muted-glyph">📺</span></h2></div>

    <!-- paste bar -->
    <div class="watch-paste">
      <input value=${input} onInput=${(e) => setInput(e.target.value)} placeholder="Paste a TikTok / Reel / video link…" inputmode="url" />
      ${parsed && html`<input class="wnoteinput" value=${note} onInput=${(e) => setNote(e.target.value)} placeholder="say something (optional)…" maxlength="140" />`}
      ${parsed && html`<div class="watch-actions">
        <span class="wchip">${(PLAT[parsed.platform] || PLAT.other).icon} ${(PLAT[parsed.platform] || PLAT.other).label}</span>
        <button class="btn sm ghost" onClick=${() => add("queue")}>＋ Queue</button>
        <button class="btn sm" onClick=${() => add("share")}>Share to ${partner ? partner.emoji : ""}</button>
      </div>`}
    </div>

    <div class="gameswitch" style="margin-top:14px">
      <button class=${view === "shares" ? "on" : ""} onClick=${() => setView("shares")}>📨 Shares${unseenForMe ? ` · ${unseenForMe}` : ""}</button>
      <button class=${view === "queue" ? "on" : ""} onClick=${() => setView("queue")}>🍿 Queue${queueItems.length ? ` · ${queueItems.length}` : ""}</button>
    </div>

    ${items === null && html`<div class="empty"><span class="big">📺</span>Loading…</div>`}

    ${view === "shares" && items !== null && html`<div class="wsec">
      <div class="weyebrow">For you${unseenForMe ? ` · ${unseenForMe} new` : ""}</div>
      ${forMe.length === 0 ? html`<div class="tiny muted" style="padding:6px 0">Nothing shared with you yet.</div>`
        : forMe.map((it) => Card(it, { unseen: !it.seen_at, sub: `from ${(players.find((p) => p.id === it.sender_id) || {}).name || "?"} · ${ago(it.created_at)}${it.seen_at ? " · seen" : ""}`,
            onOpen: () => openViewer(forMe, forMe.indexOf(it)) }))}

      <div class="weyebrow" style="margin-top:16px">Sent by you</div>
      ${sent.length === 0 ? html`<div class="tiny muted" style="padding:6px 0">Share a video with ${partner ? partner.name : "your partner"} ☝️</div>`
        : sent.map((it) => Card(it, {
            sub: it.seen_at ? `👀 ${partner ? partner.name : "seen"} · ${ago(it.seen_at)}` : `delivered · ${ago(it.created_at)}`,
            canDelete: true, onOpen: () => openViewer(sent, sent.indexOf(it)) }))}
    </div>`}

    ${view === "queue" && items !== null && html`<div class="wsec">
      ${!bothReady
        ? html`<div class="wgate">
            <div class="wgate-icon">🍿</div>
            <div class="wgate-count">${queueItems.length} ${queueItems.length === 1 ? "video" : "videos"} in the queue</div>
            <div class="tiny muted">Hidden until you're <b>both</b> ready — then you watch in order, together.</div>
            <button class=${`btn block mt ${meReady ? "ghost" : ""}`} onClick=${() => setReady(!meReady)}>${meReady ? "✓ You're ready — tap to undo" : "I'm ready to watch 🍿"}</button>
            <div class="tiny muted center" style="margin-top:8px">${players.filter((p) => p.id !== me.id).map((p) => ready[p.id] ? `${p.emoji} is ready` : `waiting for ${p.emoji} ${p.name}…`).join(" · ")}</div>
          </div>`
        : html`<div class="wreveal">
            <div class="weyebrow">Ready! ${queueItems.length} to watch — in order</div>
            ${queueItems.map((it, i) => Card(it, { sub: `#${i + 1} · added by ${(players.find((p) => p.id === it.sender_id) || {}).name || "?"}`, onOpen: () => openViewer(queueItems, i) }))}
            <button class="btn block mt" disabled=${!queueItems.length} onClick=${() => openViewer(queueItems, 0)}>▶ Start watching together</button>
            <button class="linkbtn block mt" style="width:100%" onClick=${finishQueue}>Done — clear the queue</button>
          </div>`}
    </div>`}

    ${viewer && html`<${Viewer} items=${viewer.list} index=${viewer.index} me=${me}
      onClose=${() => setViewer(null)} onNav=${navViewer} onReact=${react} />`}
  </div>`;
}
