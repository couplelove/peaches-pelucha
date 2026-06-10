// Supabase Edge Function: notify-turn
// Sends a Web Push ("Your turn!") to every subscribed device of one player.
//
// Deploy (dashboard, no CLI needed):
//   Supabase → Edge Functions → Deploy a new function → name: notify-turn
//   → paste this file → Deploy.
//   Then in the function's Details: turn OFF "Verify JWT with legacy secret"
//   (the app calls it with the new sb_publishable key, which isn't a JWT).
//   Then Edge Functions → Secrets → add:
//     VAPID_PUBLIC_KEY  = (public key from push.js)
//     VAPID_PRIVATE_KEY = (the private key Claude gave you)

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { player_id, title, body } = await req.json();
    if (!player_id) throw new Error("player_id required");

    webpush.setVapidDetails(
      "mailto:peaches.pelucha@example.com",
      Deno.env.get("VAPID_PUBLIC_KEY")!,
      Deno.env.get("VAPID_PRIVATE_KEY")!,
    );

    // Service-role client (auto-injected env) to read/clean subscriptions.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: subs, error } = await supabase
      .from("push_subscriptions").select("*").eq("player_id", player_id);
    if (error) throw error;

    let sent = 0, stale = 0;
    const payload = JSON.stringify({
      title: title || "Peaches & Pelucha",
      body: body || "It's your turn! 💗",
    });

    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (err) {
        // 404/410 = the device unsubscribed/expired → clean it up.
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", s.id);
          stale++;
        }
      }
    }

    return new Response(JSON.stringify({ sent, stale }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
