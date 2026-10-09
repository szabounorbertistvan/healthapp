"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";
import {
  ANALYTICS_CONSENT_EVENT,
  ANALYTICS_CONSENT_KEY,
  GA_MEASUREMENT_ID,
  analyticsPageLocation,
  isAnalyticsPath,
  parseConsent,
  type AnalyticsConsent,
} from "@/lib/analytics";

type GtagWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  [disableFlag: `ga-disable-${string}`]: boolean | undefined;
};

export function readConsent(): AnalyticsConsent | null {
  try {
    return parseConsent(localStorage.getItem(ANALYTICS_CONSENT_KEY));
  } catch {
    return null;
  }
}

/** Records the visitor's choice and tells the banner and the loader. */
export function writeConsent(value: AnalyticsConsent | null) {
  try {
    if (value) localStorage.setItem(ANALYTICS_CONSENT_KEY, value);
    else localStorage.removeItem(ANALYTICS_CONSENT_KEY);
  } catch {
    // storage unavailable: the choice holds for this page only
  }
  if (value !== "granted") clearGaCookies();
  window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_EVENT, { detail: value }));
}

/** On a withdrawal, the _ga cookies go too (host and parent domain). */
function clearGaCookies() {
  const names = document.cookie.split(";").map((c) => c.split("=")[0]!.trim()).filter((n) => n === "_ga" || n.startsWith("_ga_"));
  const host = location.hostname;
  const domains = [host, host.replace(/^www\./, ""), `.${host.replace(/^www\./, "")}`];
  for (const name of names) {
    document.cookie = `${name}=; Max-Age=0; path=/`;
    for (const d of domains) document.cookie = `${name}=; Max-Age=0; path=/; domain=${d}`;
  }
}

/**
 * Loads gtag.js only once the visitor has accepted, and only while they are on
 * a public page. Leaving for the app sets GA's official off switch
 * (`ga-disable-<id>`) and sends nothing more; page views are sent here, by
 * hand, for public paths only (`send_page_view: false`).
 */
export function GoogleAnalytics() {
  const pathname = usePathname();
  const [consent, setConsent] = useState<AnalyticsConsent | null>(null);
  const [load, setLoad] = useState(false);

  useEffect(() => {
    setConsent(readConsent());
    const onChange = () => setConsent(readConsent());
    window.addEventListener(ANALYTICS_CONSENT_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(ANALYTICS_CONSENT_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const allowed = Boolean(GA_MEASUREMENT_ID) && consent === "granted" && isAnalyticsPath(pathname);

  useEffect(() => {
    if (!GA_MEASUREMENT_ID) return;
    const w = window as unknown as GtagWindow;
    w[`ga-disable-${GA_MEASUREMENT_ID}`] = !allowed;
    if (!allowed) return;
    if (!w.gtag) {
      w.dataLayer = w.dataLayer ?? [];
      // gtag.js reads Arguments objects from the queue, not arrays
      w.gtag = function gtag() {
        // eslint-disable-next-line prefer-rest-params
        w.dataLayer!.push(arguments);
      };
      w.gtag("consent", "default", {
        analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied",
      });
      w.gtag("js", new Date());
      w.gtag("config", GA_MEASUREMENT_ID, { send_page_view: false });
    }
    w.gtag("event", "page_view", {
      page_location: analyticsPageLocation(location.origin, pathname ?? "/", location.search),
      page_title: document.title,
    });
    setLoad(true);
  }, [allowed, pathname]);

  if (!load || !GA_MEASUREMENT_ID) return null;
  return <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`} strategy="afterInteractive" />;
}
