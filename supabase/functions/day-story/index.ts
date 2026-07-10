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

// Who's who — so the narrative attributes actions to the right person.
const SUBJECTS =
  "The two people are: Peaches — a light-skinned woman with brown hair. Pelucha — a darker-skinned man with a beard. " +
  "Look carefully at each photo and attribute actions to the correct person by these features; never swap them. " +
  "If a photo doesn't clearly show who is who, write 'you two' / 'together' instead of guessing a name.";

const SYSTEM_BASE = [
  "You are the storyteller for Peaches 🍑 and Pelucha 🧸 — a couple keeping a lifetime of days in a shared journal.",
  SUBJECTS,
  "Given a few photos from ONE day, return a `title` and a `story`.",
  "title: a short, evocative chapter heading for the day — like a storybook page or a postcard caption (e.g. 'Cliffs Over the Fjord', 'The Red Rocks at Dusk'). 2–5 words, ≤45 characters. Title Case. No emoji, no quotes, no date.",
];
const SYSTEM = [
  ...SYSTEM_BASE,
  "story: one warm, whimsical entry — the way a beautiful children's picture-book narrates a small adventure. Voice: tender, playful, a little magical. Present tense. Second person plural ('you two', 'together') or gently name them. Notice real details you can see in the photos (light, place, weather, what they're doing) and turn the day into a tiny journey. ≤500 characters, 1–3 short sentences. No quotes, no emoji.",
].join(" ");
// Special occasions (birthdays): a real CHAPTER, not a caption — several short
// paragraphs the app lays out between the photos like pages of a book.
const SYSTEM_SPECIAL = (occasion: string) => [
  ...SYSTEM_BASE,
  `story: today is ${occasion} — write a full storybook chapter, not a caption: exactly 4 to 6 SHORT paragraphs separated by blank lines (two newlines). Editorial and tender, like a beautifully written picture book for grown-ups. Open by setting the scene; wander through what the photos actually show (light, faces, small gestures, place); let the middle swell into the celebration of the birthday person; end with a short toast-like closing paragraph that blesses the year ahead. Present tense. Second person plural ('you two', 'together') or gently name them. Each paragraph 1–3 sentences. ≤1600 characters total. No quotes, no emoji, no headings — just the paragraphs.`,
].join(" ");

const SCHEMA = {
  type: "object",
  properties: { title: { type: "string" }, story: { type: "string" } },
  required: ["title", "story"],
  additionalProperties: false,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { day, images = [], context = {}, revise = null, fresh = null, special = null } = await req.json();
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
        const buf = await r.arrayBuffer();
        if (buf.byteLength > 3_000_000) return null;            // skip multi-MB originals (would blow the worker's memory)
        const bytes = new Uint8Array(buf);
        // chunked base64 — building the binary string char-by-char churned memory
        // hard enough on big images to trip WORKER_RESOURCE_LIMIT.
        let bin = ""; const CH = 0x8000;
        for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
        return { type: "image", source: { type: "base64", media_type: ct, data: btoa(bin) } };
      } catch { return null; }
    }))).filter(Boolean);
    if (!imgs.length) return json({ error: "could not load images" }, 502);
    const ctxLines = [
      context.date ? `Date: ${context.date}.` : "",
      context.place ? `Place: ${context.place}.` : "",
      context.count ? `${context.count} photo${context.count === 1 ? "" : "s"} from this day.` : "",
      special ? `Occasion: ${special}.` : "",
    ];
    // revise mode: fix ONLY who-is-who in an existing entry; keep the wording.
    // fresh mode: a manual "rewrite" — same day & photos, but a deliberately
    // DIFFERENT take so the new story doesn't echo the old one.
    const hint = revise && (revise.story || revise.title)
      ? "Here is an existing journal entry for this day:\n" +
        `title: ${revise.title || ""}\nstory: ${revise.story || ""}\n\n` +
        "Return it again, almost verbatim — same voice, same length, same wording. Change ONLY the names/pronouns that mis-identify who is who, using the photos and the descriptions above (light-skinned woman with brown hair = Peaches; darker-skinned man with a beard = Pelucha). If it's already correct, return it unchanged. Do not improve, shorten, restyle, or re-title it (keep the title unless it names the wrong person)."
      : fresh && (fresh.story || fresh.title)
        ? [
            ...ctxLines,
            "Write a FRESH storybook entry for this day — a noticeably DIFFERENT take from the previous one below: a new opening, a new angle, and a new title. Notice details in the photos you didn't dwell on before, and do NOT reuse the previous phrasing.",
            `Previous entry — title: ${fresh.title || ""}; story: ${fresh.story || ""}`,
          ].filter(Boolean).join(" ")
        : [...ctxLines, "Write the storybook entry for this day."].filter(Boolean).join(" ");

    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: special ? 1400 : 500,
        system: special ? SYSTEM_SPECIAL(String(special)) : SYSTEM,
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
        messages: [{ role: "user", content: [...imgs, { type: "text", text: hint }] }],
      }),
    });
    if (!resp.ok) return json({ error: "anthropic " + resp.status, detail: await resp.text() }, 502);
    const data = await resp.json();
    const raw = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    let title = "", story = "";
    try { const o = JSON.parse(raw); title = (o.title || "").trim(); story = (o.story || "").trim(); }
    catch { story = raw; }
    if (!story) return json({ error: "empty story" }, 502);
    const cap = special ? 1900 : 500;
    if (story.length > cap) story = story.slice(0, cap - 1).trimEnd() + "…";
    if (title.length > 60) title = title.slice(0, 60).trimEnd();

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
          body: JSON.stringify({ day, title, story, sig: context.sig ?? null, updated_at: new Date().toISOString() }),
        });
      } catch { /* caching is best-effort */ }
    }
    return json({ title, story });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
}
