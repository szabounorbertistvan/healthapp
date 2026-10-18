import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
const updateRecipePreparation = vi.fn(async (_x: unknown) => ({ ok: true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/recipe-actions", () => ({
  updateRecipePreparation: (x: unknown) => updateRecipePreparation(x),
  deleteRecipe: async () => ({ ok: true }),
  logRecipeServings: async () => ({ ok: true }),
}));

import { dict, renderWithApp } from "@/test/render";
import { RecipePreparation } from "./recipes";

const ID = "00000000-0000-4000-8000-000000000001";
const m = dict("en").clientApp.recipes;

beforeEach(() => {
  updateRecipePreparation.mockClear();
  refresh.mockClear();
});

describe("RecipePreparation", () => {
  it("is folded by default, then shows numbered steps and the times", async () => {
    renderWithApp(<RecipePreparation recipe={{ id: ID, steps: ["Rinse the rice.", "Boil it."], prep_minutes: 5, cook_minutes: 18 }} />);
    expect(screen.queryByText("Rinse the rice.")).not.toBeInTheDocument();
    expect(screen.getByText("Prep 5 min · Cooking 18 min")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Preparation \(2\)/ }));
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Rinse the rice.", "Boil it."]);
  });

  it("says when there are no steps, and makes none up", async () => {
    renderWithApp(<RecipePreparation recipe={{ id: ID, steps: [], prep_minutes: null, cook_minutes: null }} />);
    await userEvent.click(screen.getByRole("button", { name: /Preparation/ }));
    expect(screen.getByText(m.noSteps, { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText(/min/)).not.toBeInTheDocument();
  });

  it("saves steps and times — and nothing about servings or grams", async () => {
    renderWithApp(<RecipePreparation recipe={{ id: ID, steps: [], prep_minutes: null, cook_minutes: null }} />);
    await userEvent.click(screen.getByRole("button", { name: /Preparation/ }));
    await userEvent.click(screen.getByRole("button", { name: m.addSteps }));
    await userEvent.type(screen.getByRole("textbox", { name: m.stepsLabel }), "1. Rinse{enter}{enter}2. Boil");
    await userEvent.type(screen.getByRole("textbox", { name: m.cookMinutes }), "20");
    await userEvent.click(screen.getByRole("button", { name: m.saveSteps }));
    expect(updateRecipePreparation).toHaveBeenCalledWith({ recipeId: ID, steps: ["Rinse", "Boil"], prepMinutes: null, cookMinutes: 20 });
    expect(refresh).toHaveBeenCalled();
  });

  it("refuses a time that is not whole minutes", async () => {
    renderWithApp(<RecipePreparation recipe={{ id: ID, steps: ["x"], prep_minutes: null, cook_minutes: null }} />);
    await userEvent.click(screen.getByRole("button", { name: /Preparation/ }));
    await userEvent.click(screen.getByRole("button", { name: m.editSteps }));
    await userEvent.type(screen.getByRole("textbox", { name: m.prepMinutes }), "abc");
    await userEvent.click(screen.getByRole("button", { name: m.saveSteps }));
    expect(screen.getByRole("alert")).toHaveTextContent(m.tooManySteps);
    expect(updateRecipePreparation).not.toHaveBeenCalled();
  });

  it("reads in Romanian", async () => {
    renderWithApp(<RecipePreparation recipe={{ id: ID, steps: ["Spală orezul."], prep_minutes: 5, cook_minutes: null }} />, { locale: "ro" });
    expect(screen.getByRole("button", { name: /Mod de preparare \(1\)/ })).toBeInTheDocument();
    expect(screen.getByText("Pregătire 5 min")).toBeInTheDocument();
  });
});
