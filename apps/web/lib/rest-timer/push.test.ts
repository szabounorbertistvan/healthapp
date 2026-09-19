import { describe, expect, test } from "vitest";
import { notificationState, restNotificationOptions, urlBase64ToUint8Array } from "./push";

describe("notificationState", () => {
  test("a browser without the Notification or push APIs is unsupported", () => {
    expect(notificationState({ hasNotification: false, hasServiceWorker: true, hasPushManager: true, permission: "default" })).toBe("unsupported");
    expect(notificationState({ hasNotification: true, hasServiceWorker: false, hasPushManager: true, permission: "default" })).toBe("unsupported");
    expect(notificationState({ hasNotification: true, hasServiceWorker: true, hasPushManager: false, permission: "default" })).toBe("unsupported");
  });

  test("otherwise it is the browser's permission verdict", () => {
    const supported = { hasNotification: true, hasServiceWorker: true, hasPushManager: true } as const;
    expect(notificationState({ ...supported, permission: "default" })).toBe("default");
    expect(notificationState({ ...supported, permission: "granted" })).toBe("granted");
    expect(notificationState({ ...supported, permission: "denied" })).toBe("denied");
  });
});

describe("restNotificationOptions", () => {
  test("is visual only: silent, no vibration pattern, no sound", () => {
    const options = restNotificationOptions({ id: "abc123", body: "Time for your next set.", url: "/workout/d/log" });
    expect(options.silent).toBe(true);
    expect("vibrate" in options).toBe(false);
    expect("sound" in options).toBe(false);
  });

  test("carries the timer id as its tag so a second copy replaces, not stacks", () => {
    const options = restNotificationOptions({ id: "abc123", body: "b", url: "/x" });
    expect(options.tag).toBe("rest-abc123");
    expect(options.renotify).toBe(false);
    expect(options.data).toEqual({ url: "/x", id: "abc123" });
  });
});

describe("urlBase64ToUint8Array", () => {
  test("decodes a VAPID public key into the 65 raw bytes PushManager wants", () => {
    // An uncompressed P-256 point: 0x04 followed by 64 bytes.
    const bytes = new Uint8Array(65);
    bytes[0] = 4;
    for (let i = 1; i < 65; i++) bytes[i] = i;
    const b64 = Buffer.from(bytes).toString("base64url");
    expect(Array.from(urlBase64ToUint8Array(b64))).toEqual(Array.from(bytes));
  });
});
