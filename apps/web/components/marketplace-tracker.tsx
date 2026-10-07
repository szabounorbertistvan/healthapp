"use client";
import { useEffect, useRef } from "react";
import { classifyAttribution, type Attribution, type ClientMarketplaceEvent } from "@healthapp/shared";
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
  view: "profile_view" | "directory_view";
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
      const el = (e.target as Element | null)?.closest?.("[data-mkt]");
      const event = el?.getAttribute("data-mkt");
      if (event === "cta_contact" || event === "cta_book" || event === "cta_save" || event === "cta_full_profile" || event === "signup_started") {
        trackMarketplace(event, { slug, attribution });
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [slug]);
  return null;
}
