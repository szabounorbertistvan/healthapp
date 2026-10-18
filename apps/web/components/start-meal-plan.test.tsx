import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
const startMyMealPlan = vi.fn(async () => ({ ok: true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/nutrition-actions", () => ({ startMyMealPlan: () => startMyMealPlan() }));

import { dict, renderWithApp } from "@/test/render";
import { StartMealPlanButton } from "./start-meal-plan";

describe("StartMealPlanButton", () => {
  it("starts the plan and refreshes into the builder", async () => {
    renderWithApp(<StartMealPlanButton />);
    await userEvent.click(screen.getByRole("button", { name: dict().clientApp.mealPlan.start }));
    expect(startMyMealPlan).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalled();
  });

  it("says why it could not start", async () => {
    startMyMealPlan.mockResolvedValueOnce({ ok: false, message: "Set your daily targets first" } as never);
    renderWithApp(<StartMealPlanButton />, { locale: "ro" });
    await userEvent.click(screen.getByRole("button", { name: dict("ro").clientApp.mealPlan.start }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Set your daily targets first");
  });
});
