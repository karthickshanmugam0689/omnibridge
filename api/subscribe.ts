import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { PushSubscription as WebPushSubscription } from "web-push";
import { saveSubscription } from "./_pushStore.js";

/**
 * POST /api/subscribe
 * Body: { clientId: string, subscription: PushSubscriptionJSON }
 *
 * Persists a Web Push subscription so /api/notify can later send messages
 * to all of a user's devices. See `_pushStore.ts` for the storage contract.
 *
 * Uses the classic Vercel Node handler signature (`req, res`) rather than the
 * Fetch-style one because the latter is only reliably dispatched on newer
 * runtime versions and we'd rather not pin a specific Node.js version just
 * for that.
 */

interface SubscribeBody {
  clientId?: string;
  subscription?: WebPushSubscription;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  // Vercel auto-parses JSON into req.body when Content-Type is application/json,
  // but we fall back to parsing the raw string for defensive-depth (e.g. the
  // client forgot to set the header).
  let body: SubscribeBody;
  if (typeof req.body === "string") {
    try {
      body = JSON.parse(req.body) as SubscribeBody;
    } catch {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
  } else {
    body = (req.body ?? {}) as SubscribeBody;
  }
  const clientId = body.clientId?.trim();
  const subscription = body.subscription;
  if (!clientId || !subscription?.endpoint) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }
  try {
    await saveSubscription(clientId, subscription);
  } catch (err) {
    console.error("[subscribe] saveSubscription failed:", err);
    res.status(500).json({ error: "store_failed" });
    return;
  }
  res.status(200).json({ ok: true });
}
