/// <reference lib="webworker" />

/**
 * OmniBridge service worker.
 *
 * Three responsibilities:
 *   1. Precache the app shell (HTML / JS / CSS / assets) via Workbox so the
 *      PWA opens instantly and works offline. The `__WB_MANIFEST` placeholder
 *      is replaced at build time by `vite-plugin-pwa` (injectManifest mode).
 *   2. Runtime cache for Google Fonts and the Supabase REST API so reads
 *      degrade gracefully when offline.
 *   3. Receive Web Push messages and surface them as native OS notifications,
 *      and route a notification tap to the relevant in-app screen.
 *
 * This file runs in a Service Worker context — `window` does not exist.
 * Type narrowing via `self as unknown as ServiceWorkerGlobalScope` is needed
 * because TS infers `WindowWithWorker` by default.
 */

import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { StaleWhileRevalidate, NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// ── Precache & shell routing ─────────────────────────────────────────────
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// ── Runtime caching ──────────────────────────────────────────────────────
registerRoute(
  ({ url }) =>
    url.origin === "https://fonts.googleapis.com" ||
    url.origin === "https://fonts.gstatic.com",
  new StaleWhileRevalidate({ cacheName: "google-fonts" }),
);

registerRoute(
  ({ url }) => /\.supabase\.co\/rest\/v1\/.*$/.test(url.href),
  new NetworkFirst({
    cacheName: "supabase-api",
    networkTimeoutSeconds: 5,
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 }),
    ],
  }),
);

// ── Web Push ─────────────────────────────────────────────────────────────

interface PushPayload {
  title?: string;
  body?: string;
  /** Path the user should land on when they tap the notification. */
  url?: string;
  /** Tag groups multiple pushes about the same post into a single notification. */
  tag?: string;
  /**
   * Keep the notification on-screen until the user interacts with it. Set
   * by `/api/match` for urgent posts so the helper doesn't miss the alarm
   * if their screen was off. Only Chromium honours this; Firefox ignores.
   */
  requireInteraction?: boolean;
  /** Anything we want round-tripped to the click handler. */
  data?: Record<string, unknown>;
}

function parsePush(event: PushEvent): PushPayload {
  if (!event.data) return { title: "OmniBridge", body: "You have a new update." };
  try {
    return event.data.json() as PushPayload;
  } catch {
    return { title: "OmniBridge", body: event.data.text() };
  }
}

self.addEventListener("push", (event: PushEvent) => {
  const payload = parsePush(event);
  const title = payload.title ?? "OmniBridge";
  const isUrgent =
    payload.requireInteraction === true ||
    (payload.data as { urgent?: boolean } | undefined)?.urgent === true;
  event.waitUntil(
    // `renotify` / `vibrate` / `requireInteraction` aren't in the base
    // `NotificationOptions` lib.dom type but are honoured by Chromium
    // (and vibrate also by Firefox on Android). We widen the type so
    // urgent pushes can hold the notification until the user taps AND
    // fire a distinctive SOS-style buzz. Non-urgent pushes still get a
    // gentle renotify buzz when replies come in on the same tag.
    self.registration.showNotification(title, {
      body: payload.body,
      icon: "/icons/icon.svg",
      badge: "/icons/icon.svg",
      tag: payload.tag,
      data: { url: payload.url ?? "/", ...payload.data },
      renotify: Boolean(payload.tag),
      requireInteraction: isUrgent,
      // 3 short + 1 long buzz — roughly "SOS" feel for urgent. For regular
      // pushes we let the OS default pick a friendly pattern.
      vibrate: isUrgent ? [120, 60, 120, 60, 120, 60, 400] : undefined,
    } as NotificationOptions & {
      renotify?: boolean;
      requireInteraction?: boolean;
      vibrate?: number[];
    }),
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data as { url?: string } | undefined)?.url ?? "/";
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Prefer focusing an already-open OmniBridge tab and asking it to
      // navigate, rather than opening a duplicate window.
      for (const client of allClients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(targetUrl);
            } catch {
              // Cross-origin navigation rejection — ignore, the focus alone is fine.
            }
            return;
          }
        }
      }
      await self.clients.openWindow(targetUrl);
    })(),
  );
});

// Allow the page to trigger an immediate activation (e.g. after `vite-plugin-pwa`
// detects an update) without waiting for all tabs to close.
self.addEventListener("message", (event: ExtendableMessageEvent) => {
  if ((event.data as { type?: string } | undefined)?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});
