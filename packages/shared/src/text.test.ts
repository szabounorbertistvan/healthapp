import { describe, expect, test } from "vitest";
import { matchesQuery, normalizeForSearch } from "./text";

// Romanian is the primary locale and nobody types diacritics into a search box
// at the gym. "ovaz" has to find "Fulgi de ovăz", or the library and the food
// picker are unusable in the language the app is built for.

describe("normalizeForSearch", () => {
  test("strips Romanian diacritics", () => {
    expect(normalizeForSearch("Fulgi de ovăz")).toBe("fulgi de ovaz");
    expect(normalizeForSearch("Pește")).toBe("peste");
    expect(normalizeForSearch("Împins la piept")).toBe("impins la piept");
    expect(normalizeForSearch("Sărat")).toBe("sarat");
  });

  test("lowercases and trims", () => {
    expect(normalizeForSearch("  BARBELL  ")).toBe("barbell");
  });
});

describe("matchesQuery", () => {
  test("finds a diacritic word typed without diacritics", () => {
    expect(matchesQuery("Fulgi de ovăz", "ovaz")).toBe(true);
  });

  test("normalises the query as well, not only the text", () => {
    // A coach with a Romanian keyboard typing "ovăz" must find the same row as
    // one typing "ovaz" — both sides go through the same normalisation.
    expect(matchesQuery("Fulgi de ovaz", "ovăz")).toBe(true);
    expect(matchesQuery("Fulgi de ovăz", "ovăz")).toBe(true);
  });

  test("ignores case in both directions", () => {
    expect(matchesQuery("Barbell Squat", "SQUAT")).toBe(true);
  });

  test("matches everything on an empty query", () => {
    expect(matchesQuery("anything", "")).toBe(true);
    expect(matchesQuery("anything", "   ")).toBe(true);
  });
});
