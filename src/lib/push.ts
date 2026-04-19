import { useAppStore } from "@/store/useAppStore";

/**
 * Web Push client helpers.
 *
 * Strategy:
 *   - Detect support on every call so older browsers and incognito mode degrade gracefully.
 *   - Lazy-import the SW registration the first time we need it (registration is owned by
 *     `vite-plugin-pwa`'s injected `registerSW.js`, so we just reuse the existing one).
 *   - Cache the current PushSubscription locally so the UI can render its state synchronously.
 *
 * On Safari/iOS, push subscription only works once the PWA is installed to the
 * Home Screen — we surface that as a separate `not-installed` reason so the UI
 * can show a meaningful hint instead of a generic failure.
 */

export type PushPermission = NotificationPermission;

export type PushReason =
  | "ok"
  | "unsupported"
  | "denied"
  | "default"
  | "missing-vapid"
  | "no-registration"
  | "ios-needs-install"
  | "error";

export interface PushStatus {
  /** True when this device is currently receiving pushes for OmniBridge. */
  subscribed: boolean;
  permission: PushPermission;
  /** Why we're in this state — useful for picking the right CTA. */
  reason: PushReason;
}

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? "";

/** True when the browser exposes the APIs needed for Web Push at all. */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function isIOSStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS only allows Web Push when the PWA is launched from the Home Screen.
  // `display-mode: standalone` covers Chrome/Android too, but combined with
  // an iOS UA it tells us the install actually happened.
  const ua = navigator.userAgent.toLowerCase();
  const ios = /iphone|ipad|ipod/.test(ua);
  if (!ios) return true;
  return window.matchMedia?.("(display-mode: standalone)").matches ?? false;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  // Allocate a fresh ArrayBuffer (not SharedArrayBuffer) so the resulting
  // typed array matches `BufferSource`'s ArrayBuffer-only constraint in
  // newer TS lib.dom typings.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  // `ready` waits for the active SW (registered by vite-plugin-pwa). We never
  // call `register` directly here so we don't fight the plugin's lifecycle.
  return navigator.serviceWorker.ready.catch(() => null);
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!pushSupported()) {
    return { subscribed: false, permission: "default", reason: "unsupported" };
  }
  if (!VAPID_PUBLIC_KEY) {
    return {
      subscribed: false,
      permission: Notification.permission,
      reason: "missing-vapid",
    };
  }
  const reg = await getRegistration();
  if (!reg) {
    return {
      subscribed: false,
      permission: Notification.permission,
      reason: "no-registration",
    };
  }
  const sub = await reg.pushManager.getSubscription();
  const perm = Notification.permission;
  if (perm === "denied") {
    return { subscribed: false, permission: perm, reason: "denied" };
  }
  if (!sub) {
    return {
      subscribed: false,
      permission: perm,
      reason: perm === "granted" ? "ok" : "default",
    };
  }
  return { subscribed: true, permission: perm, reason: "ok" };
}

export interface SubscribeResult {
  status: PushStatus;
  subscription?: PushSubscriptionJSON;
}

export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!pushSupported()) {
    return { status: { subscribed: false, permission: "default", reason: "unsupported" } };
  }
  if (!VAPID_PUBLIC_KEY) {
    return {
      status: {
        subscribed: false,
        permission: Notification.permission,
        reason: "missing-vapid",
      },
    };
  }
  if (!isIOSStandalone()) {
    return {
      status: {
        subscribed: false,
        permission: Notification.permission,
        reason: "ios-needs-install",
      },
    };
  }
  const reg = await getRegistration();
  if (!reg) {
    return {
      status: {
        subscribed: false,
        permission: Notification.permission,
        reason: "no-registration",
      },
    };
  }
  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") {
    return {
      status: {
        subscribed: false,
        permission,
        reason: permission === "denied" ? "denied" : "default",
      },
    };
  }
  try {
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      }));

    const json = sub.toJSON();
    const clientId = useAppStore.getState().user.clientId;

    // Best-effort persist on the server. Failures are not fatal — the
    // subscription is still usable on this device for self-pushes.
    try {
      await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, subscription: json }),
      });
    } catch (err) {
      console.warn("[push] /api/subscribe failed, continuing:", err);
    }

    return {
      status: { subscribed: true, permission, reason: "ok" },
      subscription: json,
    };
  } catch (err) {
    console.error("[push] subscribe failed:", err);
    return {
      status: {
        subscribed: false,
        permission,
        reason: "error",
      },
    };
  }
}

export async function unsubscribeFromPush(): Promise<PushStatus> {
  const reg = await getRegistration();
  if (!reg) {
    return {
      subscribed: false,
      permission: pushSupported() ? Notification.permission : "default",
      reason: "no-registration",
    };
  }
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    try {
      await sub.unsubscribe();
    } catch (err) {
      console.warn("[push] unsubscribe failed:", err);
    }
  }
  return getPushStatus();
}

/** Read the current PushSubscription as JSON, or null if not subscribed. */
export async function currentSubscription(): Promise<PushSubscriptionJSON | null> {
  const reg = await getRegistration();
  if (!reg) return null;
  const sub = await reg.pushManager.getSubscription();
  return sub ? sub.toJSON() : null;
}
