// Supabase Edge Function: mend (Fight Mode)
// Two partners privately share their side of a fight; this translates each
// person's words into what their PARTNER most needs to HEAR (feelings + needs,
// reframed kindly, never taking sides) plus one small thing to focus on, and a
// shared line about coming back together. Pure generation — the client writes
// the result to the fight row. Mirrors day-story (Anthropic HTTP + json schema).
// Verify JWT OFF; reuses ANTHROPIC_API_KEY.

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
  "You are a gentle, wise mediator helping two partners who just had a fight find their way back to each other. They love each other and do not want to stay angry. Each one has privately shared their side, how they feel, and what they need.",
  "For EACH person, translate their PARTNER's words into what they most need to HEAR: surface the feelings and needs underneath, reframe any blame or sharp words into 'I feel… / I need…', and assume good intent on both sides. Help them genuinely understand the other.",
  "Also give each person a `focus`: one small, concrete, loving thing THEY can do to reconnect, addressed warmly to them.",
  "And write one short shared `together` line: a single hopeful sentence about coming back together right now.",
  "Hard rules: never decide who is right; never take a side; no lecturing, no 'you should', no clinical/therapy jargon. Warm, plain, kind, brief, hopeful. Each `hear` is 2–3 short sentences; each `focus` is 1 sentence; `together` is 1 sentence. No emoji, no quotes, no names-as-headers.",
].join(" ");

const SIDE = { type: "object", properties: { hear: { type: "string" }, focus: { type: "string" } }, required: ["hear", "focus"], additionalProperties: false };
const SCHEMA = { type: "object", properties: { a: SIDE, b: SIDE, together: { type: "string" } }, required: ["a", "b", "together"], additionalProperties: false };

const fmtSide = (label: string, name: string, e: any) => {
  e = e || {};
  return `${label} is ${name}. ${label} shared —\n` +
    `• what happened: ${e.happened || "(left blank)"}\n` +
    `• how they feel: ${e.feeling || "(left blank)"}\n` +
    `• what they need: ${e.need || "(left blank)"}` +
    (e.love ? `\n• what they still love about ${label === "A" ? "B" : "A"}: ${e.love}` : "");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { people = [], entries = [] } = await req.json();
    if (people.length < 2 || entries.length < 2) return json({ error: "two people + entries required" }, 400);
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not set" }, 500);

    const nameA = people[0].name || "Partner A", nameB = people[1].name || "Partner B";
    const prompt =
      fmtSide("A", nameA, entries[0]) + "\n\n" + fmtSide("B", nameB, entries[1]) + "\n\n" +
      `Now write: "a" = what ${nameA} most needs to hear about ${nameB} (translate ${nameB}'s feelings & needs for ${nameA}), plus a focus for ${nameA}. ` +
      `"b" = what ${nameB} most needs to hear about ${nameA} (translate ${nameA}'s feelings & needs for ${nameB}), plus a focus for ${nameB}. ` +
      `And one shared "together" line.`;

    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 900,
        system: SYSTEM,
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      }),
    });
    if (!resp.ok) return json({ error: "anthropic " + resp.status, detail: await resp.text() }, 502);
    const out = await resp.json();
    const raw = (out.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    let data: any = null;
    try { data = JSON.parse(raw); } catch { return json({ error: "bad model output" }, 502); }
    if (!data || !data.a || !data.b) return json({ error: "empty result" }, 502);
    return json(data);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
