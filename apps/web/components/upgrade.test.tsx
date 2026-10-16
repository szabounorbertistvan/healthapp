import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
const startTrial = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/billing-actions", () => ({ startTrial: () => startTrial() }));
import { ENTITLEMENTS } from "@healthapp/shared";
import { PlanProvider, type ClientPlan } from "@/lib/plan-client";
import { dict, renderWithApp } from "@/test/render";
import { PremiumSoon, PremiumSoonGoals, TryTrialButton } from "./upgrade";

const upgrade = { href: "/billing", label: "Premium" };
function withPlan(plan: Partial<ClientPlan>, ui: React.ReactElement, locale: "en" | "ro" = "en") {
  return renderWithApp(
    <PlanProvider plan={{ e: ENTITLEMENTS.premium, upgrade, libraryVideos: false, ...plan }}>{ui}</PlanProvider>,
    { locale },
  );
}

describe("PremiumSoon", () => {
  it("tags a feature the free plan will not include, while the paywall is off", () => {
    withPlan({ later: ENTITLEMENTS.free }, <PremiumSoon feature="adaptiveTargets" />);
    expect(screen.getByText("Premium · free for now")).toBeInTheDocument();
  });

  it("speaks Romanian", () => {
    withPlan({ later: ENTITLEMENTS.free }, <PremiumSoon feature="reportExports" />, "ro");
    expect(screen.getByText("Premium · gratuit acum")).toBeInTheDocument();
  });

  it("says nothing when nothing will change (paywall on, paid, or covered by a coach)", () => {
    const { container } = withPlan({ later: null }, <PremiumSoon feature="adaptiveTargets" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says nothing about a feature the free plan keeps", () => {
    const later = { ...ENTITLEMENTS.free, photoCompare: true };
    const { container } = withPlan({ later }, <PremiumSoon feature="photoCompare" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PremiumSoonGoals", () => {
  it("names the future limit while goals are unlimited", () => {
    withPlan({ later: ENTITLEMENTS.free }, <PremiumSoonGoals />);
    const goals = dict().common.plan.soonGoals.replace("{limit}", "2").replace("{plan}", "Premium");
    expect(screen.getByText(goals)).toBeInTheDocument();
  });

  it("stays quiet once the limit applies", () => {
    const { container } = withPlan({ e: ENTITLEMENTS.free, later: ENTITLEMENTS.free }, <PremiumSoonGoals />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("TryTrialButton", () => {
  it("is not there while no trial can be started", () => {
    const { container } = withPlan({ trialAvailable: false }, <TryTrialButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("starts the trial and refreshes", async () => {
    startTrial.mockResolvedValueOnce({ ok: true, endsAt: "2026-12-01T00:00:00Z" });
    withPlan({ trialAvailable: true }, <TryTrialButton />);
    await userEvent.click(screen.getByRole("button", { name: "Try Premium free for 30 days" }));
    expect(startTrial).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalled();
  });

  it("says so when the trial was already used", async () => {
    startTrial.mockResolvedValueOnce({ ok: false, errorCode: "TRIAL_USED", message: "TRIAL_USED" });
    withPlan({ trialAvailable: true }, <TryTrialButton />, "ro");
    await userEvent.click(screen.getByRole("button", { name: "Încearcă Premium gratuit 30 de zile" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(dict("ro").common.plan.trialUsed);
  });
});
