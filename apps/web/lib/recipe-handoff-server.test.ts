import { describe, expect, it } from "vitest";
import { signHandoff, verifyHandoff, verifyHandoffCookie } from "./recipe-handoff-server";

const KEY = "k".repeat(40);
const NOW = 1_800_000_000;
const body = {
  v: 1, iat: NOW - 5, exp: NOW + 600,
  recipe: {
    id: 99647, title: "Mici tradiționali", url: "https://dishfinder.food/cooking/recipes/99647", image: null,
    servings: 20, per_serving: { kcal: 132, protein: 8.9, carbs: 0.9, fat: 10.2 },
    ingredients: [{ df_id: 3158, name: "carne tocată de vită", qty: "500 g" }],
  },
};
const p = Buffer.from(JSON.stringify(body)).toString("base64url");
const s = signHandoff(p, KEY);

describe("verifyHandoff", () => {
  it("signs exactly like DishFinder (shared test vector — the same value is asserted in DishFinder's server/__tests__/utils/voinicHandoff.test.js)", () => {
    expect(signHandoff("eyJ2IjoxfQ", KEY)).toBe("sKOeE11bM0FA2O1wJhIY4TP0krwoN96noALk7pGEZd0");
  });

  it("accepts what DishFinder signed with the shared secret", () => {
    const r = verifyHandoff(p, s, NOW, KEY);
    expect(r.ok && r.handoff.recipe.title).toBe("Mici tradiționali");
  });

  it("refuses a payload changed after signing", () => {
    const forged = Buffer.from(JSON.stringify({ ...body, recipe: { ...body.recipe, per_serving: { kcal: 5, protein: 0, carbs: 0, fat: 0 } } })).toString("base64url");
    expect(verifyHandoff(forged, s, NOW, KEY)).toEqual({ ok: false, error: "HANDOFF_SIGNATURE" });
  });

  it("refuses a signature made with another secret", () => {
    expect(verifyHandoff(p, signHandoff(p, "x".repeat(40)), NOW, KEY)).toEqual({ ok: false, error: "HANDOFF_SIGNATURE" });
  });

  it("refuses an expired hand-off even when signed", () => {
    expect(verifyHandoff(p, s, NOW + 3600, KEY)).toEqual({ ok: false, error: "HANDOFF_EXPIRED" });
  });

  it("says so when the server has no secret configured", () => {
    expect(verifyHandoff(p, s, NOW, null)).toEqual({ ok: false, error: "HANDOFF_NOT_CONFIGURED" });
  });

  it("reads the cookie form <payload>.<signature>", () => {
    expect(verifyHandoffCookie(`${p}.${s}`, NOW, KEY).ok).toBe(true);
    expect(verifyHandoffCookie(undefined, NOW, KEY).ok).toBe(false);
  });
});
