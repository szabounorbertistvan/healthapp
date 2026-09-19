// Browser-side notification plumbing for the rest timer: what the browser
// can do, asking for permission, subscribing this browser to Web Push, and
// showing a notification from the page itself when the tab is merely hidden.
//
// Two delivery paths, one notification:
//   · the page is alive but hidden (another tab, another app on desktop):
//     showLocalRestNotification() through the registered service worker;
//   · the page is frozen (locked phone): the server push, scheduled from
//     endsAt, arriving through the same worker's `push` handler.
// Both use the same tag, so a device that gets both shows one.
//
// Nothing here — and nothing in public/sw.js — asks for sound or vibration.

export type NotificationState = "unsupported" | "default" | "granted" | "denied";

export function notificationState(env: {
  hasNotification: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  permission: NotificationPermission;
}): NotificationState {
  if (!env.hasNotification || !env.hasServiceWorker || !env.hasPushManager) return "unsupported";
  return env.permission;
}

/** The current browser's verdict; "unsupported" during SSR. */
export function currentNotificationState(): NotificationState {
  if (typeof window === "undefined") return "unsupported";
  return notificationState({
    hasNotification: "Notification" in window,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    permission: "Notification" in window ? Notification.permission : "denied",
  });
}

/** The public VAPID key the app was built with; empty when push is not set up. */
export function vapidPublicKey(): string {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
}

/**
 * The options every rest notification is shown with, from the page or from
 * the worker. `silent: true` asks the platform for no sound and no vibration;
 * no `vibrate` pattern is ever set. The OS and the person's own settings have
 * the last word on that — the app only ever asks for quiet.
 */
export function restNotificationOptions(input: { id: string; body: string; url: string }): NotificationOptions & { renotify: boolean } {
  return {
    body: input.body,
    tag: `rest-${input.id}`,
    renotify: false,
    silent: true,
    icon: "/icon.png",
    data: { url: input.url, id: input.id },
  };
}

/** PushManager wants the applicationServerKey as raw bytes, not base64url. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Registers the worker once; later calls return the existing registration. */
export async function registerRestServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return registration;
  } catch {
    return null;
  }
}

export type PushKeys = { endpoint: string; p256dh: string; auth: string };

function keysOf(subscription: PushSubscription): PushKeys | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, p256dh, auth };
}

/** This browser's existing subscription, if it has one. */
export async function currentPushSubscription(): Promise<PushKeys | null> {
  const registration = await registerRestServiceWorker();
  if (!registration) return null;
  try {
    const existing = await registration.pushManager.getSubscription();
    return existing ? keysOf(existing) : null;
  } catch {
    return null;
  }
}

/**
 * Subscribe this browser. Permission must already be granted — the prompt is
 * requested by the caller from a button press, never from here.
 */
export async function subscribeToPush(publicKey: string): Promise<PushKeys | null> {
  const registration = await registerRestServiceWorker();
  if (!registration || !publicKey) return null;
  try {
    const existing = await registration.pushManager.getSubscription();
    if (existing) return keysOf(existing);
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    return keysOf(subscription);
  } catch {
    return null;
  }
}

export async function unsubscribeFromPush(): Promise<string | null> {
  const registration = await registerRestServiceWorker();
  if (!registration) return null;
  try {
    const existing = await registration.pushManager.getSubscription();
    if (!existing) return null;
    const endpoint = existing.endpoint;
    await existing.unsubscribe();
    return endpoint;
  } catch {
    return null;
  }
}

/**
 * Show the rest-finished notification from the page, for a tab that is
 * hidden but still running. Goes through the worker so the click handler is
 * the same one a server push gets.
 */
export async function showLocalRestNotification(input: { id: string; title: string; body: string; url: string }): Promise<boolean> {
  if (currentNotificationState() !== "granted") return false;
  const registration = await registerRestServiceWorker();
  if (!registration) return false;
  try {
    await registration.showNotification(input.title, restNotificationOptions(input));
    return true;
  } catch {
    return false;
  }
}
