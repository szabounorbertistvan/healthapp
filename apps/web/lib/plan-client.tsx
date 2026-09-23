"use client";
import { createContext, useContext } from "react";
import { ENTITLEMENTS, TIER_LABEL, type Entitlements } from "@healthapp/shared";

export type Upgrade = { href: string; label: string };
export type ClientPlan = { e: Entitlements; upgrade: Upgrade };

/**
 * The signed-in person's plan for client components, mounted by both layouts
 * from getPlan(). Shaped like the units and i18n providers: `usePlan().e`.
 *
 * The default is everything open — a component rendered outside a layout
 * (an admin preview, a test) must never lock someone out of a feature
 * because nobody told it the plan.
 */
const PlanContext = createContext<ClientPlan>({
  e: ENTITLEMENTS.coach_pro,
  upgrade: { href: "/billing", label: TIER_LABEL.premium },
});

export function PlanProvider({ plan, children }: { plan: ClientPlan; children: React.ReactNode }) {
  return <PlanContext.Provider value={plan}>{children}</PlanContext.Provider>;
}

export function usePlan(): ClientPlan {
  return useContext(PlanContext);
}
