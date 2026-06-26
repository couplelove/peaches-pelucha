import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

/* 💬 Private memory comments + emoji reactions — just for the two of them.
   One memory_comments row is either a COMMENT (text) or a REACTION (emoji, one
   per person per memory; toggled/replaced client-side). The hook loads + live-
   syncs the rows for a single memory; MemoryThread shows a feed of all of them
   on the home page. */

export const MEM_REACTS = ["❤️", "😂", "😍", "🥹", "🔥", "😮", "👏", "🍑"];

const rid = () => "tmp-" + Math.random().toString(36).slice(2);

export function useMemoryComments(client, me, memoryId) {
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    if (!memoryId) { setRows([]); return; }
    const { data } = await client.from("memory_comments").select("*")
      .eq("memory_id", memoryId).order("created_at", { ascending: true });
    setRows(data || []);
  }, [client, memoryId]);

  useEffect(() => {
    load();
    if (!memoryId) return;
    let ch = null;
    try {
      ch = client.channel("pp-memcom-" + memoryId)
        .on("postgres_changes", { event: "*", schema: "public", table: "memory_comments", filter: `memory_id=eq.${memoryId}` }, () => load())
        .subscribe();
    } catch {}
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    return () => { document.removeEventListener("visibilitychange", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, memoryId, load]);

  const comments = rows.filter((r) => r.text);
  const reactions = rows.filter((r) => r.emoji);
  const myReaction = reactions.find((r) => r.author_id === me.id) || null;

  const addComment = useCallback(async (text) => {
    const t = (text || "").trim().slice(0, 500);
    if (!t || !memoryId) return;
    const opt = { id: rid(), memory_id: memoryId, author_id: me.id, text: t, emoji: null, created_at: new Date().toISOString(), pending: true };
    setRows((r) => [...r, opt]);
    const { data } = await client.from("memory_comments").insert({ memory_id: memoryId, author_id: me.id, text: t }).select().single();
    setRows((r) => { const cleaned = r.filter((x) => x.id !== opt.id); return data && !cleaned.some((x) => x.id === data.id) ? [...cleaned, data] : cleaned; });
  }, [client, me, memoryId]);

  // one reaction per person per memory: same emoji again clears it, a new one replaces it.
  const toggleReaction = useCallback(async (emoji) => {
    if (!memoryId) return;
    const mine = rows.find((r) => r.author_id === me.id && r.emoji);
    if (mine && mine.emoji === emoji) {
      setRows((r) => r.filter((x) => x.id !== mine.id));
      try { navigator.vibrate && navigator.vibrate(8); } catch {}
      try { await client.from("memory_comments").delete().eq("id", mine.id); } catch {}
      return;
    }
    const opt = { id: rid(), memory_id: memoryId, author_id: me.id, emoji, text: null, created_at: new Date().toISOString() };
    setRows((r) => [...r.filter((x) => !(x.author_id === me.id && x.emoji)), opt]);
    try { navigator.vibrate && navigator.vibrate(12); } catch {}
    try {
      if (mine) await client.from("memory_comments").delete().eq("id", mine.id);
      await client.from("memory_comments").insert({ memory_id: memoryId, author_id: me.id, emoji });
      load();
    } catch {}
  }, [client, me, memoryId, rows, load]);

  return { rows, comments, reactions, myReaction, addComment, toggleReaction };
}

const ago = (iso) => {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
};

/* Home-page feed of every reaction + comment, newest first. Tap → open that
   memory. Hidden entirely until there's something to show. */
export function MemoryThread({ client, me, players, onOpenMemory }) {
  const [rows, setRows] = useState(null);
  const [mem, setMem] = useState({});
  const pinfo = (id) => players.find((p) => p.id === id) || { emoji: "❔", name: "?" };
  const thumbUrl = useCallback((m) => {
    if (!m) return null;
    try { return client.storage.from("memories").getPublicUrl(m.thumb_path || m.path).data.publicUrl; } catch { return null; }
  }, [client]);

  const load = useCallback(async () => {
    const { data } = await client.from("memory_comments").select("*").order("created_at", { ascending: false }).limit(30);
    const list = data || [];
    setRows(list);
    const ids = [...new Set(list.map((r) => r.memory_id))];
    if (ids.length) {
      const { data: mems } = await client.from("memories").select("id,thumb_path,path,kind,taken_on").in("id", ids);
      const map = {}; (mems || []).forEach((m) => { map[m.id] = m; });
      setMem(map);
    }
  }, [client]);

  useEffect(() => {
    load();
    let ch = null;
    try {
      ch = client.channel("pp-memthread")
        .on("postgres_changes", { event: "*", schema: "public", table: "memory_comments" }, () => load())
        .subscribe();
    } catch {}
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    return () => { document.removeEventListener("visibilitychange", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load]);

  if (rows === null || !rows.length) return null;   // nothing yet → don't clutter home (discoverable in the lightbox)

  return html`<div class="card memthread">
    <div class="shead"><h2>Reactions <span class="muted-glyph">💬</span></h2></div>
    <!-- swipeable image cards (like the Love Bug Calendar deck): the memory is the
         backdrop, a dark scrim under the emoji/comment keeps it readable -->
    <div class="mt-car">
      ${rows.map((r) => {
        const m = mem[r.memory_id];
        const who = pinfo(r.author_id);
        const url = thumbUrl(m);
        return html`<button class=${`mt-card ${r.emoji ? "react" : "comment"}`} key=${r.id}
          onClick=${() => onOpenMemory && onOpenMemory(r.memory_id)}>
          ${url
            ? html`<img class="mt-card-img" src=${url} alt="" loading="lazy" />`
            : html`<span class="mt-card-img mt-card-noimg">📸</span>`}
          <span class="mt-card-scrim"></span>
          ${m && m.kind === "video" && html`<span class="mt-card-play">▶</span>`}
          <span class="mt-card-top">
            <span class="mt-card-av" title=${who.name}>${who.emoji}</span>
            <span class="mt-card-time">${ago(r.created_at)}</span>
          </span>
          <span class="mt-card-main">
            ${r.emoji
              ? html`<span class="mt-card-react">${r.emoji}</span>`
              : html`<span class="mt-card-text">${r.text}</span>`}
          </span>
        </button>`;
      })}
    </div>
  </div>`;
}
