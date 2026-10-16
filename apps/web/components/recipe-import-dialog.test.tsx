import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
const refresh = vi.fn();
const saveRecipeImport = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock("@/app/recipe-actions", () => ({
  saveRecipeImport: (x: unknown) => saveRecipeImport(x),
  cancelRecipeImport: async () => ({ ok: true }),
}));
vi.mock("@/app/nutrition-actions", () => ({ searchFoods: async () => [] }));

import { dict, renderWithApp } from "@/test/render";
import { RecipeImportDialog, type ImportDialogProps } from "./recipe-import-dialog";

const props: ImportDialogProps = {
  title: "Sarmale tradiționale",
  url: "https://dishfinder.food/cooking/recipes/99648",
  image: null,
  servings: 40,
  perServing: { kcal: 123, protein: 5.8, carbs: 6.3, fat: 8.4 },
  lines: [
    { label: "1,5 kg varză murată", grams: 1500, food: { id: "00000000-0000-4000-8000-000000000001", name: "Varză murată", per100: { kcal: 19, protein: 0.9, carbs: 4.3, fat: 0.1 } } },
    { label: "500 g orez", grams: 500, food: { id: "00000000-0000-4000-8000-000000000002", name: "Orez", per100: { kcal: 360, protein: 7, carbs: 79, fat: 0.6 } } },
  ],
  existing: [],
};
const m = dict("ro").clientApp.recipes.import;

describe("RecipeImportDialog", () => {
  it("shows every line with its Voinic food and proposes the serving weight", () => {
    renderWithApp(<RecipeImportDialog {...props} />, { locale: "ro" });
    expect(screen.getByText("1,5 kg varză murată")).toBeInTheDocument();
    expect(screen.getByText("Varză murată")).toBeInTheDocument();
    // (1500 + 500) g over 40 servings
    expect(screen.getByDisplayValue("50")).toBeInTheDocument();
  });

  it("saves DishFinder's values when nothing changed", async () => {
    saveRecipeImport.mockResolvedValueOnce({ ok: true, id: "x" });
    renderWithApp(<RecipeImportDialog {...props} />, { locale: "ro" });
    await userEvent.click(screen.getByRole("button", { name: m.save }));
    expect(saveRecipeImport).toHaveBeenCalledWith(expect.objectContaining({ recompute: false, servings: 40, servingGrams: 50, replaceId: null }));
    expect(replace).toHaveBeenCalledWith("/recipes");
  });

  it("switches to recalculating once a line changes, and sends only choices", async () => {
    saveRecipeImport.mockResolvedValueOnce({ ok: true, id: "x" });
    renderWithApp(<RecipeImportDialog {...props} />, { locale: "ro" });
    const rice = screen.getByText("500 g orez").closest("li")!;
    await userEvent.click(within(rice).getByRole("button", { name: m.remove }));
    await userEvent.click(screen.getByRole("button", { name: m.save }));
    const sent = saveRecipeImport.mock.calls.at(-1)![0];
    expect(sent.recompute).toBe(true);
    expect(sent.lines[1]).toEqual({ position: 1, foodId: props.lines[1]!.food!.id, grams: 500, include: false });
    expect(JSON.stringify(sent)).not.toContain("kcal");
  });

  it("asks for the serving weight when it is missing", async () => {
    renderWithApp(<RecipeImportDialog {...props} lines={props.lines.map((l) => ({ ...l, grams: null }))} />, { locale: "ro" });
    await userEvent.click(screen.getByRole("button", { name: m.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent(m.servingGramsRequired);
  });
});
