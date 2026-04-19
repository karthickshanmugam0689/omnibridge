import type { VercelRequest, VercelResponse } from "@vercel/node";
import webpush, { type PushSubscription as WebPushSubscription } from "web-push";
import { getSubscriptions, removeSubscription } from "./_pushStore.js";

/**
 * POST /api/notify
 * Body (one of):
 *   { targetClientId: string, payload: PushPayload }
 *     → look up all stored subscriptions for that client and send.
 *   { subscription: PushSubscriptionJSON, payload: PushPayload }
 *     → send to a single subscription (used by the in-app "send test reply"
 *       demo button to round-trip a real push to the same device).
 *
 * Runs on the Node runtime so we can use `web-push` which signs push
 * messages with the VAPID private key (unavailable on Edge). Uses the
 * classic `(req, res)` handler signature for maximum runtime compatibility.
 *
 * Failed subscriptions (HTTP 404/410 from the push service — user cleared
 * site data / revoked permission) are pruned from the store so subsequent
 * calls don't keep retrying dead endpoints.
 */

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

interface NotifyBody {
  targetClientId?: string;
  subscription?: WebPushSubscription;
  payload?: PushPayload;
}

let vapidConfigured = false;
function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY ?? "";
  const priv = process.env.VAPID_PRIVATE_KEY ?? "";
  const subject = process.env.VAPID_SUBJECT ?? "mailto:hello@omnibridge.local";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  vapidConfigured = true;
  return true;
}

interface SendOutcome {
  endpoint: string;
  ok: boolean;
  status?: number;
}

async function sendOne(
  sub: WebPushSubscription,
  payload: PushPayload,
  ownerClientId: string | null,
): Promise<SendOutcome> {
  try {
    const res = await webpush.sendNotification(sub, JSON.stringify(payload));
    return { endpoint: sub.endpoint, ok: true, status: res.statusCode };
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      if (ownerClientId) {
        void removeSubscription(ownerClientId, sub.endpoint).catch(() => {});
      }
    } else {
      console.warn("[notify] sendNotification failed:", err);
    }
    return { endpoint: sub.endpoint, ok: false, status };
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!ensureVapid()) {
    res.status(500).json({
      error: "vapid_not_configured",
      hint: "Set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY in env.",
    });
    return;
  }
  let body: NotifyBody;
  if (typeof req.body === "string") {
    try {
      body = JSON.parse(req.body) as NotifyBody;
    } catch {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
  } else {
    body = (req.body ?? {}) as NotifyBody;
  }
  const payload = body.payload ?? { title: "OmniBridge", body: "You have a new update." };

  if (body.subscription?.endpoint) {
    const outcome = await sendOne(body.subscription, payload, null);
    res.status(200).json({ sent: outcome.ok ? 1 : 0, outcomes: [outcome] });
    return;
  }

  const targetClientId = body.targetClientId?.trim();
  if (!targetClientId) {
    res.status(400).json({ error: "missing_target" });
    return;
  }
  const subs = await getSubscriptions(targetClientId);
  if (subs.length === 0) {
    res.status(200).json({ sent: 0, outcomes: [], reason: "no_subscriptions" });
    return;
  }
  const outcomes = await Promise.all(
    subs.map((s) => sendOne(s.subscription, payload, targetClientId)),
  );
  const sent = outcomes.filter((o) => o.ok).length;
  res.status(200).json({ sent, outcomes });
}
