// The one service worker (app/sw.ts, built by app/serwist/[path]/route.ts).
// Both callers register the same URL with the same scope, so the browser
// keeps a single registration — and with it the rest timer's push
// subscription, which belongs to the registration, not to the script.

export const SERVICE_WORKER_URL = "/serwist/sw.js";

/** Registers the worker once; later calls return the existing registration. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
    await navigator.serviceWorker.ready;
    return registration;
  } catch {
    return null;
  }
}
