import { writeFileSync } from "node:fs";
import { expect, test as base, type BrowserContext } from "@playwright/test";
import { isLocalRequest } from "../scripts/lib/local-target.mjs";

/**
 * The browser side of the production guard. target() refuses non-local
 * addresses before anything starts; this fence covers what an app could still
 * do once running: every request a page makes that would leave this machine
 * is aborted, so a sign-in or a write can never reach another Supabase — not
 * through a mis-wired app, a redirect, or an absolute URL in a page.
 *
 * Images, fonts and media are only aborted (a missing picture is not a
 * failure, and they carry no session). Anything else that tried to leave —
 * a page, fetch/XHR, a websocket — fails the test that made it.
 */
const QUIET = new Set(["image", "font", "media", "stylesheet"]);

export async function fence(context: BrowserContext): Promise<() => string[]> {
  const violations: string[] = [];
  await context.route((url) => !isLocalRequest(url.toString()), (route) => {
    const request = route.request();
    if (!QUIET.has(request.resourceType())) violations.push(`${request.method()} ${request.url()} (${request.resourceType()})`);
    return route.abort("blockedbyclient");
  });
  return () => violations;
}

/**
 * React's hydration failures, as a production build reports them: minified
 * errors #418 (server HTML did not match), #423 (recovered by rendering on the
 * client) and #425 (text did not match), raised through reportError (a
 * `pageerror`) or logged. A recovered mismatch is not harmless: for a moment
 * the page holds the server's DOM and the client's side by side — the
 * nutrition spec once found two plan-name fields — and focus and input state
 * are thrown away. Collected per page, failed with the message at the end.
 */
const HYDRATION = /Minified React error #(418|421|423|425)\b|Hydration failed|hydrat(ion|ing) .*(mismatch|did not match)|before it finished hydrating/i;

/**
 * E2E_DIAG_STREAM=1: a timeline of React's streaming in every page — when each
 * `S:<n>` segment container is inserted and removed, every call of the inline
 * swap functions ($RC complete boundary, $RV reveal, $RS segment, $RX client-render, $RR)
 * with whether their target still existed, page lifecycle events and RSC
 * requests. Written to `stream-timeline.txt` when a test ends with a segment
 * container still in the DOM (docs/GAPS.md, "Streamed page content left behind").
 */
function streamProbe() {
  const w = window as unknown as { __stream: string[] } & Record<string, unknown>;
  w.__stream = [];
  const t0 = performance.now();
  const log = (s: string) => w.__stream.push(`${Math.round(performance.now() - t0)}ms ${s}`);
  for (const name of ["$RC", "$RS", "$RX", "$RR", "$RV"]) {
    let real: unknown;
    Object.defineProperty(window, name, {
      configurable: true,
      get: () => real,
      set: (fn: unknown) => {
        real = typeof fn !== "function" ? fn : function (this: unknown, ...a: unknown[]) {
          const ids = a.filter((x): x is string => typeof x === "string");
          log(`${name}(${ids.join(",")}) targets: ${ids.map((id) => `${id}=${document.getElementById(id) ? "present" : "missing"}`).join(" ")}`);
          return (fn as (...x: unknown[]) => unknown).apply(this, a);
        };
      },
    });
  }
  new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) if (n instanceof HTMLElement && /^S:/.test(n.id)) log(`+ #${n.id}`);
      for (const n of r.removedNodes) if (n instanceof HTMLElement && /^S:/.test(n.id)) log(`- #${n.id}`);
    }
  }).observe(document, { childList: true, subtree: true });
  addEventListener("pageshow", (e) => log(`pageshow persisted=${(e as PageTransitionEvent).persisted}`));
  document.addEventListener("DOMContentLoaded", () => log(`DOMContentLoaded visibility=${document.visibilityState} focus=${document.hasFocus()}`));
  // React 19.2 reveals a streamed boundary on an animation frame ($RC queues, $RV swaps)
  requestAnimationFrame(() => log(`first animation frame visibility=${document.visibilityState}`));
  document.addEventListener("visibilitychange", () => log(`visibilitychange ${document.visibilityState}`));
  addEventListener("load", () => log("load"));
  const f = window.fetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    const h = new Headers(init?.headers);
    if (h.get("rsc") || h.get("next-action")) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      log(`fetch ${h.get("next-action") ? "action" : h.get("next-router-prefetch") ? "prefetch" : "rsc"} ${url.replace(location.origin, "")}`);
    }
    return f.apply(this, [input, init] as never);
  };
}

export const test = base.extend<{ networkFence: void; hydrationErrors: void; streamTimeline: void }>({
  streamTimeline: [
    async ({ context }, use, testInfo) => {
      if (process.env.E2E_DIAG_STREAM !== "1") return use();
      await context.addInitScript(streamProbe);
      await use();
      const out: string[] = [];
      for (const page of context.pages()) {
        const r = await page.evaluate(() => ({
          url: location.pathname,
          orphans: [...document.querySelectorAll("div[hidden][id^='S:']")].map((d) => d.id),
          log: (window as unknown as { __stream?: string[] }).__stream ?? [],
        })).catch(() => null);
        if (r && r.orphans.length) out.push(`== ${r.url} orphaned: ${r.orphans.join(", ")}\n${r.log.join("\n")}`);
      }
      if (out.length) writeFileSync(testInfo.outputPath("stream-timeline.txt"), out.join("\n\n"));
    },
    { auto: true },
  ],
  networkFence: [
    async ({ context }, use) => {
      const violations = await fence(context);
      await use();
      expect(violations(), "requests that tried to leave this machine").toEqual([]);
    },
    { auto: true },
  ],
  hydrationErrors: [
    async ({ context }, use, testInfo) => {
      const seen: string[] = [];
      // every browser error, attached to the result so a failure carries its console
      const errors: string[] = [];
      const watch = (page: import("@playwright/test").Page) => {
        page.on("pageerror", (e) => {
          errors.push(`[pageerror] ${page.url()} — ${e.message}`);
          if (HYDRATION.test(e.message)) seen.push(`${page.url()} — ${e.message}`);
        });
        page.on("console", (m) => {
          if (m.type() !== "error") return;
          errors.push(`[console] ${page.url()} — ${m.text()}`);
          if (HYDRATION.test(m.text())) seen.push(`${page.url()} — ${m.text()}`);
        });
      };
      context.pages().forEach(watch);
      context.on("page", watch);
      await use();
      if (errors.length) {
        const file = testInfo.outputPath("browser-errors.txt");
        writeFileSync(file, errors.join("\n"));
        await testInfo.attach("browser-errors", { path: file, contentType: "text/plain" });
      }
      expect(seen, "hydration errors (server and client rendered different HTML)").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
