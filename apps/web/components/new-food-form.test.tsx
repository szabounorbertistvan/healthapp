import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createCustomFood = vi.fn(async (..._a: unknown[]) => ({
  ok: true,
  food: { id: "f-1", name_en: "Zacusca", name_ro: "Zacusca", group: "", per_100g: { kcal: 95, protein: 1.5, carbs: 8, fat: 6 }, portions: [] },
}));
vi.mock("@/app/nutrition-actions", () => ({
  createCustomFood: (...a: unknown[]) => createCustomFood(...a),
}));

import { dict, renderWithApp } from "@/test/render";
import { NewFoodForm } from "./new-food-form";

const m = dict().clientWidgets.newFoodForm;

describe("NewFoodForm", () => {
  beforeEach(() => createCustomFood.mockClear());

  it("opens on a scanned code and saves it with the label values and a serving", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    renderWithApp(<NewFoodForm initialBarcode="5940000000001" onCreated={onCreated} onCancel={() => {}} />);

    // the details are open by themselves when a scan brought the person here
    expect(screen.getByLabelText(m.barcode)).toHaveValue("5940000000001");
    expect(screen.getByLabelText(m.barcode)).toBeVisible();

    await user.type(screen.getByLabelText(m.name), "Zacusca");
    await user.type(screen.getByLabelText(m.kcal), "95");
    await user.type(screen.getByLabelText(m.protein), "1,5");
    await user.type(screen.getByLabelText(m.carbs), "8");
    await user.type(screen.getByLabelText(m.fat), "6");
    await user.type(screen.getByLabelText(m.salt), "1,1");
    await user.click(screen.getByRole("button", { name: `+ ${m.addPortion}` }));
    await user.type(screen.getByLabelText(m.portionLabel), "1 jar");
    await user.type(screen.getByLabelText(m.portionGrams), "400");
    await user.click(screen.getByRole("button", { name: m.save }));

    expect(createCustomFood).toHaveBeenCalledWith({
      name: "Zacusca",
      brand: "",
      kcal: 95,
      protein: 1.5,
      carbs: 8,
      fat: 6,
      saturatedFat: null,
      sugar: null,
      salt: 1.1,
      barcode: "5940000000001",
      portions: [{ label: "1 jar", grams: 400 }],
    });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "f-1" }));
  });

  it("keeps Save off until there is a name and a parsable kcal", async () => {
    const user = userEvent.setup();
    renderWithApp(<NewFoodForm onCreated={() => {}} onCancel={() => {}} />);
    const save = screen.getByRole("button", { name: m.save });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText(m.name), "Ciorba");
    await user.type(screen.getByLabelText(m.kcal), "abc");
    expect(save).toBeDisabled();
    await user.clear(screen.getByLabelText(m.kcal));
    await user.type(screen.getByLabelText(m.kcal), "45");
    expect(save).toBeEnabled();
  });

  it("shows the server's sentence when the save is refused", async () => {
    const user = userEvent.setup();
    createCustomFood.mockResolvedValueOnce({ ok: false, message: m.labelTooMuch } as never);
    renderWithApp(<NewFoodForm initialName="Ciorba" onCreated={() => {}} onCancel={() => {}} />);
    await user.type(screen.getByLabelText(m.kcal), "45");
    await user.click(screen.getByRole("button", { name: m.save }));
    expect(await screen.findByText(m.labelTooMuch)).toBeInTheDocument();
  });
});
