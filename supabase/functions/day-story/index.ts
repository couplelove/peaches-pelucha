// Supabase Edge Function: day-story
// Sends a day's photos to Claude (vision) and returns a short, whimsical
// kids-book narrative of the day — then caches it in `day_stories`.
//
// Deploy: Supabase dashboard → Edge Functions → paste this (slug "day-story").
// Secrets needed: ANTHROPIC_API_KEY (set in the function's secrets).
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.
// Verify JWT: OFF (the app calls with the publishable key, which isn't a JWT —
//   same as notify-turn).

const MODEL = "claude-opus-4-8";          // vision-capable; swap to claude-haiku-4-5 to cut cost
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = [
  "You are the storyteller for Peaches 🍑 and Pelucha 🧸 — a couple keeping a lifetime of days in a shared journal.",
  "Given a few photos from ONE day, write a single warm, whimsical entry — the way a beautiful children's picture-book narrates a small adventure.",
  "Voice: tender, playful, a little magical. Present tense. Second person plural ('you two', 'together') OR gently name them. Notice real details you can see in the photos (light, place, weather, what they're doing) and turn the day into a tiny journey.",
  "HARD RULES: 500 characters MAX (count them). 1–3 short sentences. No preamble, no quotation marks, no titles, no emoji, no hashtags. Output ONLY the story text.",
].join(" ");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { day, images = [], context = {} } = await req.json();
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not set" }, 500);
    if (!images.length) return json({ error: "no images" }, 400);

    // Fetch each image server-side and inline it as base64. (Sending image URLs
    // directly fails when the host's robots.txt blocks Anthropic's fetcher; the
    // function's own fetch isn't subject to that.)
    const imgs = (await Promise.all(images.slice(0, 6).map(async (url: string) => {
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const ct = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
        if (!ct.startsWith("image/")) return null;
        const bytes = new Uint8Array(await r.arrayBuffer());
        let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return { type: "image", source: { type: "base64", media_type: ct, data: btoa(bin) } };
      } catch { return null; }
    }))).filter(Boolean);
    if (!imgs.length) return json({ error: "could not load images" }, 502);
    const hint = [
      context.date ? `Date: ${context.date}.` : "",
      context.place ? `Place: ${context.place}.` : "",
      context.count ? `${context.count} photo${context.count === 1 ? "" : "s"} from this day.` : "",
      "Write the storybook entry for this day.",
    ].filter(Boolean).join(" ");

    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: "user", content: [...imgs, { type: "text", text: hint }] }],
      }),
    });
    if (!resp.ok) return json({ error: "anthropic " + resp.status, detail: await resp.text() }, 502);
    const data = await resp.json();
    let story = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ").trim();
    if (!story) return json({ error: "empty story" }, 502);
    if (story.length > 500) story = story.slice(0, 499).trimEnd() + "…";

    // cache it so the partner sees it and we never regenerate this day's photos
    const sbUrl = Deno.env.get("SUPABASE_URL");
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (day && sbUrl && svc) {
      try {
        await fetch(`${sbUrl}/rest/v1/day_stories?on_conflict=day`, {
          method: "POST",
          headers: {
            apikey: svc, Authorization: `Bearer ${svc}`,
            "content-type": "application/json", Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify({ day, story, sig: context.sig ?? null, updated_at: new Date().toISOString() }),
        });
      } catch { /* caching is best-effort */ }
    }
    return json({ story });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
}
