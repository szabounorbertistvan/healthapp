// Voinic service worker — Web Push for the rest timer, nothing else.
//
// No fetch handler on purpose: this worker caches nothing and never sits in
// front of a request, so it cannot serve a stale page or break a deploy. Its
// whole job is the two events below. Registered lazily from the app
// (lib/rest-timer/push.ts) — not on page load, and not before the person has
// asked for notifications.
//
// Visual only: `silent: true`, no `vibrate` pattern, no sound. The platform
// and the person's own notification settings decide the rest.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    payload = null;
  }
  if (!payload || payload.kind !== "rest_finished") return;

  const id = String(payload.id || "");
  const url = typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/today";
  event.waitUntil(
    self.registration.showNotification(String(payload.title || ""), {
      body: String(payload.body || ""),
      tag: "rest-" + id,
      renotify: false,
      silent: true,
      icon: "/icon.png",
      data: { url, id },
    }),
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
