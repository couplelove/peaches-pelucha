// Supabase Edge Function: family-note
// Writes a heartfelt note from the couple into the family feed — paired with a
// recent photo of them. Run weekly by pg_cron (P&P only) so Gramma keeps getting
// love even on quiet weeks. The message varies: sometimes a short "missing you,
// praying for your health 💗", sometimes a longer tender note. Uses the shared
// ANTHROPIC_API_KEY + the service role. Verify JWT OFF.

const MODEL = "claude-opus-4-8";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

const SYSTEM = [
  "You are writing a short, heartfelt note FROM a loving couple (a granddaughter and her partner) TO their grandmother — 'Gramma' — who follows their little photo-sharing app and adores seeing their life.",
  "The note appears in her feed to keep her feeling close and loved, especially on weeks when few new photos were added.",
  "VARY it each time so it never feels canned: sometimes just a tender one-liner ('Missing you, Gramma — praying over your health every day 💗'), sometimes a warmer few sentences recalling how much she means to them, sometimes a gentle 'come see what we've been up to'. Mix the mood: cozy, grateful, prayerful, playful, nostalgic.",
  "Warm, plain, sincere, a little intimate — like a real granddaughter texting her gramma. Address her as Gramma. 1–4 short sentences. At most one or two emoji. No sign-off line, no subject, no quotes around it.",
].join(" ");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { force = false } = await req.json().catch(() => ({}));
    const url = Deno.env.get("SUPABASE_URL")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const rest = { apikey: svc, Authorization: `Bearer ${svc}`, "content-type": "application/json" };

    // de-dupe: skip if an auto note already went out in the last 5 days
    if (!force) {
      const recent = await fetch(`${url}/rest/v1/family_notes?select=created_at&kind=eq.auto&order=created_at.desc&limit=1`, { headers: rest });
      if (recent.ok) {
        const r = await recent.json();
        if (r[0] && (Date.now() - new Date(r[0].created_at).getTime()) < 5 * 864e5) return json({ skipped: "recent" });
      }
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not set" }, 500);

    // pick a recent photo of the couple to pair with the note
    const photoRes = await fetch(`${url}/rest/v1/memories?select=path,thumb_path,blur,place&kind=eq.photo&order=created_at.desc&limit=30`, { headers: rest });
    const photos: any[] = photoRes.ok ? await photoRes.json() : [];
    const withThumb = photos.filter((p) => p.thumb_path);
    const pick = (withThumb.length ? withThumb : photos)[Math.floor(Math.random() * (withThumb.length || photos.length || 1))] || null;
    const place = (photos.find((p) => p.place) || {}).place || null;

    // a little variety nudge so successive notes differ
    const moods = ["a tender one-liner", "a warm few sentences", "a prayerful note for her health", "a playful 'come see us'", "a nostalgic, grateful note"];
    const mood = moods[Math.floor(Math.random() * moods.length)];
    const prompt = `Write this week's note to Gramma — make it ${mood}.` + (place ? ` (Lately they've been around ${place}, if it helps — but don't force it.)` : "");

    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM,
        output_config: { format: { type: "json_schema", schema: { type: "object", properties: { message: { type: "string" } }, required: ["message"], additionalProperties: false } } },
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      }),
    });
    if (!resp.ok) return json({ error: "anthropic " + resp.status, detail: await resp.text() }, 502);
    const out = await resp.json();
    const raw = (out.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    let msg = "";
    try { msg = JSON.parse(raw).message; } catch { msg = raw; }
    if (!msg) return json({ error: "empty message" }, 502);

    const ins = await fetch(`${url}/rest/v1/family_notes`, {
      method: "POST",
      headers: { ...rest, Prefer: "return=representation" },
      body: JSON.stringify({ text: msg, kind: "auto", photo_path: pick?.path || null, thumb_path: pick?.thumb_path || null, blur: pick?.blur || null }),
    });
    if (!ins.ok) return json({ error: "db " + ins.status, detail: await ins.text() }, 502);
    return json({ ok: true, note: (await ins.json())[0] });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
