"use client";
import { useI18n } from "@/lib/i18n/client";
import type { DurationUnit, PriceUnit } from "@/lib/coach-profile";
import { formatPrice } from "@/lib/coach-onboarding";

// How a service reads, shared by the coach's editor (lists.tsx) and the public
// page (preview.tsx) — small on purpose, so the public page does not pull the
// editor and its server actions into its bundle.

/** "60 minutes", "12 săptămâni" — or null when the service has no duration. */
export function useServiceDuration() {
  const { t } = useI18n();
  const s = t.coachProfile.services;
  return (value: number | null, unit: DurationUnit | null) => (value && unit ? `${value} ${s.durationUnits[unit]}` : null);
}

/** The price line of a service: "Free", "400 RON / month", "Price on request", "Price shared after contact". */
export function useServicePrice() {
  const { t, locale } = useI18n();
  const s = t.coachProfile.services;
  return (sv: { price_unit: PriceUnit; price_cents: number | null; currency: string | null; price_public: boolean }) => {
    if (sv.price_unit === "free") return s.free;
    if (!sv.price_public) return s.priceHidden;
    const price = formatPrice(sv.price_cents, sv.currency, locale);
    return price ? `${price} ${s.unitShort[sv.price_unit]}`.trim() : s.onRequest;
  };
}
