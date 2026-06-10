// Client-side helpers for "Your turn" push alerts.
//
// Each phone subscribes via the browser's PushManager and we store the
// subscription in `push_subscriptions` keyed to the player. Sending happens in
// the `notify-turn` Supabase Edge Function (see supabase/functions/), which
// signs messages with the VAPID private key (kept as a function secret).

// Public half of the VAPID pair — safe to ship in the client. The private half
// lives ONLY as an Edge Function secret.
export const VAPID_PUBLIC_KEY =
  "BGqzDqmIYJlLXRc3NkUZXwfC2995uEgymoJwZUZnBbe3r73nBY8L01w9UI8FTNICdq4vT8Znipm_LttH8tZD-FM";

function keyBytes(b64url) {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// 'unsupported' | 'denied' | 'enabled' | 'off'
export async function pushStatus() {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return "unsupported"; // SW not registered (e.g. localhost dev)
  const sub = await reg.pushManager.getSubscription();
  return sub ? "enabled" : "off";
}

export async function enablePush(client, playerId) {
  if (!pushSupported()) throw new Error("This browser can't do notifications. On iPhone, use the installed home-screen app (iOS 16.4+).");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications not allowed. Enable them for this app in Settings.");
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error("Open the installed app (not a localhost preview) to enable alerts.");
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(VAPID_PUBLIC_KEY),
  });
  const j = sub.toJSON();
  const { error } = await client.from("push_subscriptions").upsert(
    { player_id: playerId, endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
    { onConflict: "endpoint" }
  );
  if (error) throw new Error(error.message);
}

export async function disablePush(client) {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) {
    await client.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
}

// Fire-and-forget: nudge `playerId`'s phones. Never blocks or breaks gameplay.
export function notifyTurn(client, playerId, title, body) {
  try {
    if (!client.functions || !client.functions.invoke) return;
    client.functions
      .invoke("notify-turn", { body: { player_id: playerId, title, body } })
      .catch(() => {});
  } catch {}
}
