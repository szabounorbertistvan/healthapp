/// <reference lib="webworker" />
// Voinic service worker. Built by app/serwist/[path]/route.ts (Serwist,
// esbuild) and served at /serwist/sw.js with scope "/".
//
// Two jobs:
//
// 1. Loading without a signal, conservatively. Only what carries no one's data
//    is cached: the build's JS/CSS/fonts (precache — content-hashed, so a
//    deploy can never be served stale), the exercise and brand images, and
//    the /offline page that a failed navigation falls back to. Pages and RSC
//    payloads are never cached: they are one person's health data, and a
//    phone that changes hands must not show the last person's screens.
//    Development caches nothing at all (no precache manifest, no runtime
//    rules), exactly like the push-only worker this replaced.
//
// 2. Web Push for the rest timer, unchanged from the old public/sw.js. No
//    `vibrate` pattern and no sound, ever. Whether the notification is shown
//    as an alert (so a locked phone can light up for it) or filed silently is
//    the person's own setting, carried on the payload as `alert`; the platform
//    and their notification settings decide everything after that.
import { CacheFirst, ExpirationPlugin, NetworkOnly, Serwist, type PrecacheEntry, type RuntimeCaching } from "serwist";

declare global {
  interface WorkerGlobalScope {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const OFFLINE_URL = "/offline";
const DAY = 24 * 60 * 60;

const runtimeCaching: RuntimeCaching[] =
  process.env.NODE_ENV === "production"
    ? [
        {
          // Public, never per-person: the exercise demos (47 MB in public/, so
          // cached as they are seen rather than up front), brand art, reactions.
          matcher: ({ sameOrigin, url }) => sameOrigin && /^\/(exercises|brand|reactions)\//.test(url.pathname),
          handler: new CacheFirst({
            cacheName: "public-images",
            plugins: [new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 30 * DAY, maxAgeFrom: "last-used" })],
          }),
        },
        {
          // Never cached; NetworkOnly is here only so a failed page load gets
          // the /offline fallback below instead of the browser's error.
          matcher: ({ request }) => request.mode === "navigate",
          handler: new NetworkOnly(),
        },
      ]
    : [];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  fallbacks: {
    entries: [{ url: OFFLINE_URL, matcher: ({ request }) => request.destination === "document" }],
  },
});

serwist.addEventListeners();

type RestPush = { kind?: string; id?: unknown; url?: unknown; alert?: unknown; title?: unknown; body?: unknown };

self.addEventListener("push", (event) => {
  let payload: RestPush | null = null;
  try {
    payload = event.data ? (event.data.json() as RestPush) : null;
  } catch {
    payload = null;
  }
  if (!payload || payload.kind !== "rest_finished") return;

  const id = String(payload.id || "");
  const url = typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/today";
  const alert = payload.alert !== false;
  const tag = "rest-" + id;
  // A push must always show something (iOS revokes the subscription of a
  // worker that swallows pushes), and iOS stacks same-tag notifications
  // instead of replacing them. So close the page's own copy of this rest,
  // if it got there first, and then show the push's.
  event.waitUntil(
    self.registration
      .getNotifications({ tag })
      .then((existing) => existing.forEach((n) => n.close()))
      .catch(() => undefined)
      .then(() =>
        self.registration.showNotification(String(payload.title || ""), {
          body: String(payload.body || ""),
          tag,
          // `renotify` is real but missing from TypeScript's NotificationOptions.
          ...({ renotify: false } as NotificationOptions),
          silent: !alert,
          requireInteraction: alert,
          icon: "/icon.png",
          data: { url, id },
        }),
      ),
  );
});

// Tapping the notification brings the person back to the workout they were
// resting in: an open tab on that page is focused, otherwise one is opened.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/today";
  const absolute = new URL(target, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const same = windows.find((w) => w.url === absolute) || windows.find((w) => w.url.startsWith(self.location.origin));
      if (same) {
        return same.focus().then((focused) => (focused && focused.url !== absolute ? focused.navigate(absolute) : focused));
      }
      return self.clients.openWindow(absolute);
    }),
  );
});
