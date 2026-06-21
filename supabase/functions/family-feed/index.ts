// Supabase Edge Function: family-feed
// A passcode-gated, READ-ONLY public window into the couple's memories for
// family. The public family.html page ships NO database key — it only POSTs a
// passcode here; this function checks it against the FAMILY_PASSCODE secret and,
// only on a match, returns a page of memories (+ their AI day-stories) with
// public image/video URLs. Nothing else in the database is reachable from here.
// Verify JWT OFF (so the page can call it with no auth); the passcode is the gate.
// Uses PostgREST over fetch (no supabase-js import — keeps the worker booting).

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { passcode = "", offset = 0, limit = 48 } = await req.json().catch(() => ({}));
    const SECRET = (Deno.env.get("FAMILY_PASSCODE") || "").trim();
    if (!SECRET || String(passcode).trim() !== SECRET) return json({ error: "unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const rest = { apikey: svc, Authorization: `Bearer ${svc}` };

    const lim = Math.min(Math.max(parseInt(String(limit)) || 48, 1), 96);
    const off = Math.max(parseInt(String(offset)) || 0, 0);

    const memRes = await fetch(
      `${url}/rest/v1/memories?select=id,path,thumb_path,blur,kind,taken_on,place,created_at` +
      `&order=taken_on.desc,created_at.desc&limit=${lim}&offset=${off}`,
      { headers: rest },
    );
    if (!memRes.ok) return json({ error: "db " + memRes.status, detail: await memRes.text() }, 502);
    const mems: any[] = await memRes.json();

    const pub = (p: string) => `${url}/storage/v1/object/public/memories/${p}`;
    const render = (p: string, w: number) =>
      `${url}/storage/v1/render/image/public/memories/${p}?width=${w}&quality=72`;

    const items = (mems || []).map((m) => ({
      id: m.id,
      kind: m.kind,
      taken_on: m.taken_on,
      place: m.place,
      blur: m.blur,
      // small preview for the grid/feed (stored thumb, or a resized render of a
      // legacy photo; thumbless videos have no still → the page shows a poster tile)
      thumb: m.thumb_path ? pub(m.thumb_path) : (m.kind === "photo" ? render(m.path, 400) : null),
      hero: m.thumb_path ? pub(m.thumb_path) : (m.kind === "photo" ? render(m.path, 800) : null),
      // full media for the lightbox (the photo, or the video file to stream)
      full: pub(m.path),
    }));

    const days = [...new Set(items.map((i) => i.taken_on).filter(Boolean))];
    const stories: Record<string, { title?: string; story?: string }> = {};
    if (days.length) {
      const list = days.map((d) => `"${d}"`).join(",");
      const stRes = await fetch(
        `${url}/rest/v1/day_stories?select=day,title,story&day=in.(${encodeURIComponent(list)})`,
        { headers: rest },
      );
      if (stRes.ok) {
        const st: any[] = await stRes.json();
        st.forEach((s) => { stories[s.day] = { title: s.title, story: s.story }; });
      }
    }

    return json({ items, stories, done: (mems || []).length < lim });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
