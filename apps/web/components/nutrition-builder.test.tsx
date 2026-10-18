import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
const actions = {
  addMealDayVariant: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  addPlanFood: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  publishNutritionPlan: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  removeMealDayVariant: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  removePlanFood: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  updatePlanFoodGrams: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  setMealRecipe: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  addExtraMeal: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  renameExtraMeal: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  removeExtraMeal: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
};
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/nutrition-actions", () => ({
  addMealDayVariant: (...a: unknown[]) => actions.addMealDayVariant(...a),
  addPlanFood: (...a: unknown[]) => actions.addPlanFood(...a),
  publishNutritionPlan: (...a: unknown[]) => actions.publishNutritionPlan(...a),
  removeMealDayVariant: (...a: unknown[]) => actions.removeMealDayVariant(...a),
  removePlanFood: (...a: unknown[]) => actions.removePlanFood(...a),
  updatePlanFoodGrams: (...a: unknown[]) => actions.updatePlanFoodGrams(...a),
  setMealRecipe: (...a: unknown[]) => actions.setMealRecipe(...a),
  addExtraMeal: (...a: unknown[]) => actions.addExtraMeal(...a),
  renameExtraMeal: (...a: unknown[]) => actions.renameExtraMeal(...a),
  removeExtraMeal: (...a: unknown[]) => actions.removeExtraMeal(...a),
  searchFoods: async () => [],
}));
vi.mock("@/app/recipe-actions", () => ({
  updateRecipePreparation: async () => ({ ok: true }),
  deleteRecipe: async () => ({ ok: true }),
  logRecipeServings: async () => ({ ok: true }),
}));

import { portionMacros, sumMacros } from "@healthapp/shared";
import { dict, renderWithApp } from "@/test/render";
import type { NutritionPlanDetail, PlanFoodRow, PlanMealRow } from "@/lib/types";
import { NutritionBuilder, withDrafts } from "./nutrition-builder";

const EGG_PORTIONS = [
  { label: "M", grams: 50, note: "medium, 53-63 g with shell" },
  { label: "L", grams: 58, note: "large, 63-73 g with shell" },
];

function food(id: string, name: string, grams: number, per100g: PlanFoodRow["per100g"], portions: PlanFoodRow["portions"] = []): PlanFoodRow {
  return { id, food_id: `f-${id}`, food_name: name, food_name_en: name, grams, per100g, portions, macros: portionMacros(per100g, grams) };
}
const POSITION = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 } as const;
function meal(
  id: string, slot: PlanMealRow["slot"], name: string, day_index: number, foods: PlanFoodRow[],
  more: Partial<Pick<PlanMealRow, "extra" | "recipe" | "position">> = {},
): PlanMealRow {
  return {
    id, slot, name, day_index, position: POSITION[slot], extra: false, recipe: "none", ...more,
    foods, totals: sumMacros(foods.map((f) => f.macros)),
  };
}

// Base day: eggs 143 + rice 260 = 403 kcal. Tuesday's own lunch (chicken, 413)
// replaces the rice: 143 + 413 = 556. The old builder summed every row: 816.
const breakfast = meal("m-bf", "breakfast", "Breakfast", 0, [
  food("r-egg", "Ou", 100, { kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5 }, EGG_PORTIONS),
]);
const lunch = meal("m-lunch", "lunch", "Lunch", 0, [food("r-rice", "Orez fiert", 200, { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 })]);
const tuesdayLunch = meal("m-lunch-tue", "lunch", "Lunch", 2, [food("r-chicken", "Piept de pui", 250, { kcal: 165, protein: 31, carbs: 0, fat: 3.6 })]);

function plan(overrides: Partial<NutritionPlanDetail> = {}): NutritionPlanDetail {
  const meals = overrides.meals ?? [breakfast, lunch, tuesdayLunch];
  return {
    id: "p-1", name: "Cut", client_name: "Ana", status: "draft",
    kcal_target: 500, protein_target_g: 40, carbs_target_g: 60, fat_target_g: 15,
    meals, days: [], ...overrides,
  };
}
const m = dict("en").coachWidgets.nutritionBuilder;

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockClear();
  refresh.mockClear();
});

describe("NutritionBuilder · days", () => {
  it("opens on the base menu and counts each day by the meals it resolves to", () => {
    renderWithApp(<NutritionBuilder plan={plan()} />);
    expect(screen.getByRole("tab", { name: /Every day/ })).toHaveAttribute("aria-selected", "true");
    // Monday eats the base menu, Tuesday its own lunch — never both lunches.
    expect(screen.getByRole("tab", { name: /^Monday: 403 kcal, below target/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Tuesday: 556 kcal, above target/ })).toBeInTheDocument();
    expect(screen.queryByText(/816/)).not.toBeInTheDocument();
    // the base menu lists only the every-day meals, and says which days differ
    expect(screen.queryByText("Piept de pui")).not.toBeInTheDocument();
    expect(screen.getByText("Has its own version on: Tue")).toBeInTheDocument();
  });

  it("keeps the week total apart from the daily comparison", () => {
    renderWithApp(<NutritionBuilder plan={plan()} />);
    expect(screen.getByText(/Week: 2974 kcal in all, 425 kcal a day on average/)).toBeInTheDocument();
  });

  it("on Tuesday shows Tuesday's lunch, the inherited breakfast read-only, and the excess", async () => {
    renderWithApp(<NutritionBuilder plan={plan()} />);
    await userEvent.click(screen.getByRole("tab", { name: /^Tuesday/ }));
    expect(screen.getByText("Piept de pui")).toBeInTheDocument();
    expect(screen.queryByText("Orez fiert")).not.toBeInTheDocument();
    expect(screen.getByText("Same as every day")).toBeInTheDocument();
    // only Tuesday's own lunch has a grams field; the base breakfast is changed by copying it first
    expect(screen.getAllByRole("spinbutton", { name: m.gramsLabel })).toHaveLength(1);
    expect(screen.getByText("Tuesday against the daily target")).toBeInTheDocument();
    // the calories box: status, absolute and relative difference
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "above target · +56 kcal (+11%)")).toBeInTheDocument();
    expect(screen.getByText("Largest meal of the day: Lunch, 413 kcal.")).toBeInTheDocument();
  });

  it("changes a base meal for one day by copying it there — or starting it empty", async () => {
    renderWithApp(<NutritionBuilder plan={plan()} />);
    await userEvent.click(screen.getByRole("tab", { name: /^Wednesday/ }));
    await userEvent.click(screen.getAllByRole("button", { name: "Change for Wednesday only" })[0]!);
    expect(actions.addMealDayVariant).toHaveBeenCalledWith("p-1", "m-bf", 3, true);
    await userEvent.click(screen.getAllByRole("button", { name: "Replace on Wednesday" })[1]!);
    expect(actions.addMealDayVariant).toHaveBeenLastCalledWith("p-1", "m-lunch", 3, false);
    expect(actions.updatePlanFoodGrams).not.toHaveBeenCalled();
  });

  it("drops a day's own version back to the every-day meal", async () => {
    renderWithApp(<NutritionBuilder plan={plan()} />);
    await userEvent.click(screen.getByRole("tab", { name: /^Tuesday/ }));
    await userEvent.click(screen.getByRole("button", { name: m.backToEveryDay }));
    expect(actions.removeMealDayVariant).toHaveBeenCalledWith("p-1", "m-lunch-tue");
  });

  it("says when a day has nothing planned", () => {
    renderWithApp(<NutritionBuilder plan={plan({ meals: [meal("m-bf", "breakfast", "Breakfast", 0, [])] })} />);
    expect(screen.getByText("Nothing planned for Every day yet.")).toBeInTheDocument();
  });
});

describe("NutritionBuilder · quantities", () => {
  it("re-costs the day as grams are typed, then saves on blur", async () => {
    renderWithApp(<NutritionBuilder plan={plan()} />);
    const rice = screen.getAllByRole("spinbutton", { name: m.gramsLabel })[1]!;
    fireEvent.change(rice, { target: { value: "100" } });
    // 143 + 130 = 273 before anything is saved
    expect(screen.getByRole("tab", { name: /^Monday: 273 kcal/ })).toBeInTheDocument();
    // Tuesday does not eat the base rice, so it does not move
    expect(screen.getByRole("tab", { name: /^Tuesday: 556 kcal/ })).toBeInTheDocument();
    fireEvent.blur(rice);
    expect(actions.updatePlanFoodGrams).toHaveBeenCalledWith("p-1", "r-rice", 100);
  });

  it("shows grams in everyday pieces when the food has a serving that measures them", () => {
    renderWithApp(<NutritionBuilder plan={plan()} />);
    expect(screen.getByText("2 × M · 100 g edible")).toBeInTheDocument();
    // rice has no standard piece: grams only, and it says so
    expect(screen.getByText("200 g")).toBeInTheDocument();
    expect(screen.getAllByText(m.noServing).length).toBeGreaterThan(0);
  });

  it("writes grams from the piece count", async () => {
    renderWithApp(<NutritionBuilder plan={plan()} />);
    await userEvent.click(screen.getByRole("button", { name: m.morePieces }));
    expect(actions.updatePlanFoodGrams).toHaveBeenCalledWith("p-1", "r-egg", 150);
    await userEvent.click(screen.getByRole("button", { name: "L · 58 g" }));
    expect(actions.updatePlanFoodGrams).toHaveBeenLastCalledWith("p-1", "r-egg", 58);
  });

  it("puts a failed save back to the saved grams", async () => {
    actions.updatePlanFoodGrams.mockResolvedValueOnce({ ok: false, message: "nope" } as never);
    renderWithApp(<NutritionBuilder plan={plan()} />);
    const rice = screen.getAllByRole("spinbutton", { name: m.gramsLabel })[1]!;
    fireEvent.change(rice, { target: { value: "100" } });
    fireEvent.blur(rice);
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    expect(screen.getByRole("tab", { name: /^Monday: 403 kcal/ })).toBeInTheDocument();
  });
});

describe("withDrafts", () => {
  it("re-costs only the edited row and leaves other meals as the same objects", () => {
    const out = withDrafts([breakfast, lunch], { "r-rice": 50 }, new Set());
    expect(out[0]).toBe(breakfast);
    expect(out[1]!.totals.kcal).toBe(65);
  });
  it("drops removed rows from the totals", () => {
    expect(withDrafts([breakfast], {}, new Set(["r-egg"]))[0]!.totals.kcal).toBe(0);
  });
});

describe("NutritionBuilder · Romanian", () => {
  it("speaks Romanian throughout the day view", async () => {
    renderWithApp(<NutritionBuilder plan={plan()} />, { locale: "ro" });
    await userEvent.click(screen.getByRole("tab", { name: /^Miercuri/ }));
    const card = screen.getAllByRole("button", { name: "Schimbă doar pentru Miercuri" });
    expect(card.length).toBe(2);
    expect(within(screen.getByRole("tablist")).getByRole("tab", { name: /^Marți: 556 kcal, peste țintă/ })).toBeInTheDocument();
  });
});

// ---------- linked recipes and extra meals (20261204100000) ----------
import type { PlanRecipe } from "@/lib/plan-recipe";

const SARMALE: PlanRecipe = {
  id: "00000000-0000-4000-8000-0000000000aa", title: "Sarmale", servings: 40, serving_grams: 80,
  prep_minutes: 40, cook_minutes: 180, steps: ["Rinse the cabbage.", "Roll and simmer."],
  lines: [{ label: "1,5 kg varză murată", grams: 1500 }],
};
const extras = (n = 1) => Array.from({ length: n }, (_, i) =>
  meal(`m-x${i}`, "snack", i === 0 ? "Pre-workout" : `Extra ${i}`, 2,
    i === 0 ? [food("r-banana", "Banană", 118, { kcal: 89, protein: 1.1, carbs: 23, fat: 0.3 })] : [],
    { extra: true, position: 100 + i }));

describe("NutritionBuilder · extra meals", () => {
  it("adds an extra meal to its day only, and to that day's total", async () => {
    renderWithApp(<NutritionBuilder plan={plan({ meals: [breakfast, lunch, tuesdayLunch, ...extras()] })} />);
    // Tuesday 556 + banana 105; Monday untouched
    expect(screen.getByRole("tab", { name: /^Tuesday: 661 kcal/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Monday: 403 kcal/ })).toBeInTheDocument();
    expect(screen.queryByText("Pre-workout")).not.toBeInTheDocument(); // not on the base menu
    await userEvent.click(screen.getByRole("tab", { name: /^Monday/ }));
    expect(screen.queryByText("Pre-workout")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /^Tuesday/ }));
    expect(screen.getByText("Pre-workout")).toBeInTheDocument();
    expect(screen.getByText("Extra · Tue")).toBeInTheDocument();
    // an extra is renamed or removed, never "back to the every-day meal"
    expect(screen.getAllByRole("button", { name: m.backToEveryDay })).toHaveLength(1);
  });

  it("creates one for the selected weekday with a name and the diary meal it logs into", async () => {
    renderWithApp(<NutritionBuilder plan={plan()} />);
    expect(screen.queryByRole("button", { name: m.addExtra })).not.toBeInTheDocument(); // base menu: none
    await userEvent.click(screen.getByRole("tab", { name: /^Thursday/ }));
    await userEvent.click(screen.getByRole("button", { name: m.addExtra }));
    await userEvent.type(screen.getByRole("textbox", { name: m.extraName }), "Pre-workout");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: m.extraLogsInto }), "lunch");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(actions.addExtraMeal).toHaveBeenCalledWith({ planId: "p-1", dayIndex: 4, slot: "lunch", name: "Pre-workout" });
  });

  it("stops at four a day", async () => {
    renderWithApp(<NutritionBuilder plan={plan({ meals: [breakfast, ...extras(4)] })} />);
    await userEvent.click(screen.getByRole("tab", { name: /^Tuesday/ }));
    expect(screen.getByRole("button", { name: m.addExtra })).toBeDisabled();
    expect(screen.getByText(m.extraLimit)).toBeInTheDocument();
  });

  it("renames and removes an extra meal", async () => {
    renderWithApp(<NutritionBuilder plan={plan({ meals: [breakfast, ...extras()] })} />);
    await userEvent.click(screen.getByRole("tab", { name: /^Tuesday/ }));
    await userEvent.click(screen.getByRole("button", { name: m.rename }));
    const input = screen.getByRole("textbox", { name: m.extraName });
    await userEvent.clear(input);
    await userEvent.type(input, "Gym snack{enter}");
    expect(actions.renameExtraMeal).toHaveBeenCalledWith("p-1", "m-x0", "Gym snack");
    await userEvent.click(screen.getByRole("button", { name: m.removeExtra }));
    expect(actions.removeExtraMeal).not.toHaveBeenCalled(); // asks first
    await userEvent.click(screen.getByRole("button", { name: m.removeExtraYes }));
    expect(actions.removeExtraMeal).toHaveBeenCalledWith("p-1", "m-x0");
  });
});

describe("NutritionBuilder · linked recipes", () => {
  it("links one of the editor's recipes to a meal", async () => {
    renderWithApp(<NutritionBuilder plan={plan()} recipes={[{ id: SARMALE.id, title: "Sarmale" }]} />);
    await userEvent.selectOptions(screen.getAllByRole("combobox", { name: m.chooseRecipe })[1]!, SARMALE.id);
    await userEvent.click(screen.getAllByRole("button", { name: m.linkRecipe })[1]!);
    expect(actions.setMealRecipe).toHaveBeenCalledWith("p-1", "m-lunch", SARMALE.id);
  });

  it("shows the recipe's ingredients, steps and times — and counts nothing extra", async () => {
    const linked = { ...lunch, recipe: SARMALE };
    renderWithApp(<NutritionBuilder plan={plan({ meals: [breakfast, linked, tuesdayLunch] })} />);
    expect(screen.getByRole("tab", { name: /^Monday: 403 kcal/ })).toBeInTheDocument(); // same as unlinked
    await userEvent.click(screen.getByRole("button", { name: /Recipe and preparation/ }));
    expect(screen.getByText("1,5 kg varză murată")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").some((li) => li.textContent === "Roll and simmer.")).toBe(true);
    expect(screen.getByText(/Prep 40 min · Cooking 180 min/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: m.unlinkRecipe }));
    expect(actions.setMealRecipe).toHaveBeenCalledWith("p-1", "m-lunch", null);
  });

  it("says so when the linked recipe can no longer be read, and the plan still works", () => {
    renderWithApp(<NutritionBuilder plan={plan({ meals: [breakfast, { ...lunch, recipe: "unavailable" }] })} />);
    expect(screen.getByText(m.recipeUnavailable)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Monday: 403 kcal/ })).toBeInTheDocument();
  });

  it("asks for a saved recipe first when the editor has none", () => {
    renderWithApp(<NutritionBuilder plan={plan()} />);
    expect(screen.getAllByText(m.noRecipes).length).toBeGreaterThan(0);
  });

  it("speaks Romanian", async () => {
    renderWithApp(<NutritionBuilder plan={plan({ meals: [breakfast, ...extras()] })} />, { locale: "ro" });
    await userEvent.click(screen.getByRole("tab", { name: /^Marți/ }));
    expect(screen.getByText("În plus · Mar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Masă în plus" })).toBeInTheDocument();
  });
});

// ---------- a person's own plan (/food/plan) ----------
import { ENTITLEMENTS } from "@healthapp/shared";
import { PlanProvider } from "@/lib/plan-client";

describe("NutritionBuilder · solo", () => {
  const freeClient = { e: ENTITLEMENTS.free, upgrade: { href: "/billing", label: "Premium" }, libraryVideos: false };

  it("has nothing to publish and no client to name", () => {
    renderWithApp(<NutritionBuilder plan={plan({ client_name: "Me" })} solo />);
    expect(screen.queryByRole("button", { name: m.publish })).not.toBeInTheDocument();
    expect(screen.queryByText(/cannot see this until you publish/)).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Tuesday: 556 kcal/ })).toBeInTheDocument();
  });

  it("lets a client account fill its own meals — the coaching gate is not for this plan", async () => {
    renderWithApp(<PlanProvider plan={freeClient}><NutritionBuilder plan={plan()} solo /></PlanProvider>);
    await userEvent.click(screen.getAllByRole("button", { name: m.addFood })[0]!);
    expect(screen.getByPlaceholderText(m.searchFoods)).toBeInTheDocument();
  });

  it("keeps the gate on a coach's plan for the same account", async () => {
    renderWithApp(<PlanProvider plan={freeClient}><NutritionBuilder plan={plan()} /></PlanProvider>);
    await userEvent.click(screen.getAllByRole("button", { name: m.addFood })[0]!);
    expect(screen.queryByPlaceholderText(m.searchFoods)).not.toBeInTheDocument();
  });
});
