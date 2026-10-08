"use client";
import { useEffect, useRef } from "react";
import { classifyAttribution, isLoginWall, type Attribution, type ClientMarketplaceEvent } from "@healthapp/shared";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * First-party marketplace measurement (20261110120000). One RPC,
 * marketplace_track(), straight from the browser — so the database hashes
 * the visitor's own IP and agent into today's visitor id and stores neither.
 * Nothing is written to the device (no cookie, no storage), nothing is sent
 * anywhere else, and a failure is silent: measurement never gets in the way.
 */
export function trackMarketplace(event: ClientMarketplaceEvent, opts: {
  slug?: string | null; attribution?: Attribution | null; city?: string | null; specialization?: string | null;
  /** One word from the event's closed list (a filter's name, native | copy, what a sign-in wall stopped) — never a value. */
  detail?: string | null;
} = {}): void {
  try {
    void supabaseBrowser().rpc("marketplace_track", {
      p_event: event,
      p_slug: opts.slug ?? null,
      p_source: opts.attribution?.source ?? null,
      p_medium: opts.attribution?.medium ?? null,
      p_campaign: opts.attribution?.campaign ?? null,
      p_city: opts.city ?? null,
      p_specialization: opts.specialization ?? null,
      ...(opts.detail ? { p_detail: opts.detail } : {}),
    }).then(() => undefined, () => undefined);
  } catch {
    // not configured, or offline: nothing to measure
  }
}

/** This visit's source, from the URL's utm_* and the referrer — read once, never stored. */
export function currentAttribution(): Attribution {
  if (typeof window === "undefined") return { source: null, medium: null, campaign: null };
  const q = new URLSearchParams(window.location.search);
  return classifyAttribution({
    utmSource: q.get("utm_source"), utmMedium: q.get("utm_medium"), utmCampaign: q.get("utm_campaign"),
    referrer: document.referrer || null, siteHost: window.location.hostname,
  });
}

/**
 * Mounted once on a measured page: records the page view, then any click on
 * an element marked data-mkt="<event>" (Contact, Book, Save, Create account,
 * See the full profile…) — so the buttons themselves stay as they are.
 * Once per mount; the database also counts a visitor once a day per target.
 */
export function MarketplaceTracker({ view, slug = null, city = null, specialization = null }: {
  /** service_view: a service's booking page (20261111120000). */
  view: "profile_view" | "directory_view" | "service_view";
  slug?: string | null;
  city?: string | null;
  specialization?: string | null;
}) {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    const key = `${view}:${slug ?? ""}:${city ?? ""}:${specialization ?? ""}`;
    if (sent.current === key) return;
    sent.current = key;
    trackMarketplace(view, { slug, attribution: currentAttribution(), city, specialization });
  }, [view, slug, city, specialization]);

  useEffect(() => {
    if (!slug) return;
    const attribution = currentAttribution();
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const el = target?.closest?.("[data-mkt]");
      const event = el?.getAttribute("data-mkt");
      if (event === "cta_contact" || event === "cta_book" || event === "cta_save" || event === "cta_full_profile" || event === "signup_started") {
        trackMarketplace(event, { slug, attribution });
      }
      // an anonymous reader's action that leads to sign-in (data-mkt-wall="contact" | "book" | …)
      const wall = target?.closest?.("[data-mkt-wall]")?.getAttribute("data-mkt-wall");
      if (isLoginWall(wall)) trackMarketplace("login_required", { slug, attribution, detail: wall });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [slug]);
  return null;
}
