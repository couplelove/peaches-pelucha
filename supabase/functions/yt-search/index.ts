// Supabase Edge Function: yt-search
// Keyless YouTube search for the "Listen Together" radio. Fetches the public
// results page and pulls video ids + titles out of ytInitialData — no API key,
// no quota, nothing for the couple to set up. Returns the top music-ish hits.
//
// Deploy: Management API (PATCH/POST). Verify JWT OFF (app calls with the
// publishable key, same as the other functions).

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { q, limit = 10 } = await req.json();
    if (!q || !String(q).trim()) return json({ results: [] });
    // bias toward listenable music
    const query = String(q).trim();
    const url = "https://www.youtube.com/results?search_query=" + encodeURIComponent(query) +
      // EgIQAQ%3D%3D = the "Videos" filter; keeps out channels/playlists
      "&sp=EgIQAQ%253D%253D";
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" } });
    if (!r.ok) return json({ error: "youtube " + r.status }, 502);
    const html = await r.text();

    // Pull each videoRenderer's id + title out of ytInitialData. One regex,
    // global — order preserved = YouTube's own relevance ranking.
    const re = /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})".*?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/g;
    const seen = new Set<string>();
    const results: { videoId: string; title: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && results.length < Math.min(limit, 20)) {
      const id = m[1];
      if (seen.has(id)) continue;
      seen.add(id);
      let title = m[2];
      try { title = JSON.parse('"' + title + '"'); } catch { /* leave escaped */ }
      results.push({ videoId: id, title });
    }
    return json({ results });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
