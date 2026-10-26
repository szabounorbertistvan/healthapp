import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const deleteCustomFood = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock("@/app/nutrition-actions", () => ({
  deleteCustomFood: (...a: unknown[]) => deleteCustomFood(...a),
  createCustomFood: vi.fn(),
  updateCustomFood: vi.fn(),
}));

import { dict, renderWithApp } from "@/test/render";
import type { MyCustomFood } from "@/lib/client-nutrition";
import { MyFoods } from "./my-foods";

const m = dict().clientApp.myFoods;
const food: MyCustomFood = {
  id: "f-1", name: "Zacusca", brand: null, barcode: "5940000000001",
  per_100g: { kcal: 95, protein: 1.5, carbs: 8, fat: 6 },
  saturatedFat: null, sugar: null, salt: null, portions: [],
};

describe("MyFoods", () => {
  beforeEach(() => {
    deleteCustomFood.mockClear();
    refresh.mockClear();
  });

  it("says so when there is nothing yet", () => {
    renderWithApp(<MyFoods foods={[]} />);
    expect(screen.getByText(m.empty)).toBeInTheDocument();
  });

  it("deletes a food only after the confirmation", async () => {
    const user = userEvent.setup();
    renderWithApp(<MyFoods foods={[food]} />);
    await user.click(screen.getByRole("button", { name: m.remove }));
    expect(deleteCustomFood).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: m.removeYes }));
    expect(deleteCustomFood).toHaveBeenCalledWith("f-1");
    expect(refresh).toHaveBeenCalled();
  });

  it("shows why a food in a meal plan cannot go", async () => {
    const user = userEvent.setup();
    deleteCustomFood.mockResolvedValueOnce({ ok: false, message: m.inPlan } as never);
    renderWithApp(<MyFoods foods={[food]} />);
    await user.click(screen.getByRole("button", { name: m.remove }));
    await user.click(screen.getByRole("button", { name: m.removeYes }));
    expect(await screen.findByRole("alert")).toHaveTextContent(m.inPlan);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("opens the filled-in form on Edit", async () => {
    const user = userEvent.setup();
    renderWithApp(<MyFoods foods={[food]} />);
    await user.click(screen.getByRole("button", { name: m.edit }));
    expect(screen.getByText(dict().clientWidgets.newFoodForm.editTitle)).toBeInTheDocument();
  });
});
