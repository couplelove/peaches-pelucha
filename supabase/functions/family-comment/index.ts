// Supabase Edge Function: family-comment
// Lets family (e.g. Gramma) leave a comment from the passcode-gated family page.
// It writes into memory_comments as a NON-player author (author_id null,
// author_name/author_emoji set), so the couple sees it in their Reactions feed.
// Also lists the FAMILY comments on a memory (never the couple's private ones).
// Verify JWT OFF; the FAMILY_PASSCODE secret is the gate. PostgREST over fetch.

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
    const { passcode = "", action = "post", memory_id = "", name = "", emoji = "👵", text = "" } = await req.json().catch(() => ({}));
    const SECRET = (Deno.env.get("FAMILY_PASSCODE") || "").trim();
    if (!SECRET || String(passcode).trim() !== SECRET) return json({ error: "unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const rest = { apikey: svc, Authorization: `Bearer ${svc}`, "content-type": "application/json" };

    if (action === "list") {
      if (!memory_id) return json({ comments: [] });
      // ONLY family comments (author_id is null) — the couple's own notes stay private
      const r = await fetch(
        `${url}/rest/v1/memory_comments?select=id,author_name,author_emoji,text,created_at&memory_id=eq.${memory_id}&author_id=is.null&order=created_at.asc`,
        { headers: rest },
      );
      const rows = r.ok ? await r.json() : [];
      return json({ comments: rows });
    }

    // post
    const body = String(text || "").trim().slice(0, 600);
    if (!body || !memory_id) return json({ error: "empty" }, 400);
    const who = String(name || "").trim().slice(0, 40) || "Family";
    const em = String(emoji || "👵").trim().slice(0, 8) || "👵";
    const ins = await fetch(`${url}/rest/v1/memory_comments`, {
      method: "POST",
      headers: { ...rest, Prefer: "return=representation" },
      body: JSON.stringify({ memory_id, author_id: null, author_name: who, author_emoji: em, text: body, emoji: null }),
    });
    if (!ins.ok) return json({ error: "db " + ins.status, detail: await ins.text() }, 502);
    const row = (await ins.json())[0];
    return json({ ok: true, comment: row });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
