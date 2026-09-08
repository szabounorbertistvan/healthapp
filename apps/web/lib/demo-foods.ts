import { matchesQuery, normalizeForSearch, type Macros } from "@healthapp/shared";

// Demo food table.
//
// In a live install foods come from the `foods` table, filled on demand by the
// food-search and barcode-lookup edge functions (Open Food Facts, cached on
// first use — plan §7). Demo mode has neither a database nor network access, so
// this is a hand-written set of staples with Romanian names, enough to compose
// a real meal plan. Values are per 100 g, the same basis the schema uses.

export type DemoFood = {
  id: string;
  name_en: string;
  name_ro: string;
  group: string;
  per_100g: Macros;
  /** Manufacturer, for branded products from Open Food Facts. */
  brand?: string | null;
  /** Servings carried on the row in live mode; absent for demo rows. */
  portions?: FoodPortion[];
};

const f = (
  id: string,
  name_en: string,
  name_ro: string,
  group: string,
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
): DemoFood => ({ id, name_en, name_ro, group, per_100g: { kcal, protein, carbs, fat } });

export const demoFoods: DemoFood[] = [
  // protein
  f("chicken-breast", "Chicken breast, raw", "Piept de pui, crud", "protein", 165, 31, 0, 3.6),
  f("chicken-thigh", "Chicken thigh, raw", "Pulpă de pui, crudă", "protein", 209, 26, 0, 10.9),
  f("turkey-breast", "Turkey breast", "Piept de curcan", "protein", 135, 30, 0, 1),
  f("beef-mince-10", "Beef mince 10%", "Carne tocată de vită 10%", "protein", 176, 20, 0, 10),
  f("pork-loin", "Pork loin", "Mușchi de porc", "protein", 143, 21, 0, 6),
  f("salmon", "Salmon", "Somon", "protein", 208, 20, 0, 13),
  f("cod", "Cod", "Cod", "protein", 82, 18, 0, 0.7),
  f("tuna-can", "Tuna in water, canned", "Ton în apă, conservă", "protein", 116, 26, 0, 1),
  f("egg", "Egg, whole", "Ou întreg", "protein", 143, 12.6, 0.7, 9.5),
  f("egg-white", "Egg white", "Albuș de ou", "protein", 52, 11, 0.7, 0.2),
  f("whey", "Whey isolate", "Proteină din zer izolat", "protein", 370, 85, 4, 1.5),
  f("greek-yogurt", "Greek yogurt 2%", "Iaurt grecesc 2%", "dairy", 73, 10, 3.6, 2),
  f("cottage-cheese", "Cottage cheese", "Brânză de vaci", "dairy", 98, 11, 3.4, 4.3),
  f("telemea", "Telemea cheese", "Telemea", "dairy", 260, 17, 1, 21),
  f("milk-15", "Milk 1.5%", "Lapte 1,5%", "dairy", 47, 3.4, 4.8, 1.5),
  f("kefir", "Kefir", "Chefir", "dairy", 55, 3.3, 4.5, 2.5),

  // carbs
  f("oats", "Oats", "Fulgi de ovăz", "carbs", 389, 16.9, 66.3, 6.9),
  f("rice-cooked", "Rice, cooked", "Orez fiert", "carbs", 130, 2.7, 28, 0.3),
  f("rice-raw", "Rice, raw", "Orez crud", "carbs", 360, 7, 79, 0.6),
  f("pasta-cooked", "Pasta, cooked", "Paste fierte", "carbs", 158, 5.8, 31, 0.9),
  f("potato", "Potatoes", "Cartofi", "carbs", 77, 2, 17, 0.1),
  f("sweet-potato", "Sweet potato", "Cartof dulce", "carbs", 86, 1.6, 20, 0.1),
  f("bread-wholegrain", "Wholegrain bread", "Pâine integrală", "carbs", 247, 13, 41, 3.4),
  f("polenta", "Polenta, cooked", "Mămăligă", "carbs", 85, 2, 18, 0.4),
  f("buckwheat", "Buckwheat, cooked", "Hrișcă fiartă", "carbs", 92, 3.4, 20, 0.6),
  f("quinoa", "Quinoa, cooked", "Quinoa fiartă", "carbs", 120, 4.4, 21, 1.9),
  f("lentils", "Lentils, cooked", "Linte fiartă", "carbs", 116, 9, 20, 0.4),
  f("chickpeas", "Chickpeas, cooked", "Năut fiert", "carbs", 164, 8.9, 27, 2.6),
  f("beans-white", "White beans, cooked", "Fasole albă fiartă", "carbs", 139, 9.7, 25, 0.5),

  // fruit & veg
  f("banana", "Banana", "Banană", "fruit", 89, 1.1, 23, 0.3),
  f("apple", "Apple", "Măr", "fruit", 52, 0.3, 14, 0.2),
  f("blueberries", "Blueberries", "Afine", "fruit", 57, 0.7, 14.5, 0.3),
  f("strawberries", "Strawberries", "Căpșuni", "fruit", 32, 0.7, 7.7, 0.3),
  f("orange", "Orange", "Portocală", "fruit", 47, 0.9, 12, 0.1),
  f("grapes", "Grapes", "Struguri", "fruit", 69, 0.7, 18, 0.2),
  f("broccoli", "Broccoli", "Broccoli", "veg", 34, 2.8, 7, 0.4),
  f("spinach", "Spinach", "Spanac", "veg", 23, 2.9, 3.6, 0.4),
  f("tomato", "Tomato", "Roșie", "veg", 18, 0.9, 3.9, 0.2),
  f("cucumber", "Cucumber", "Castravete", "veg", 15, 0.7, 3.6, 0.1),
  f("bell-pepper", "Bell pepper", "Ardei gras", "veg", 31, 1, 6, 0.3),
  f("carrot", "Carrot", "Morcov", "veg", 41, 0.9, 10, 0.2),
  f("onion", "Onion", "Ceapă", "veg", 40, 1.1, 9.3, 0.1),
  f("zucchini", "Zucchini", "Dovlecel", "veg", 17, 1.2, 3.1, 0.3),
  f("mixed-salad", "Mixed salad", "Salată mixtă", "veg", 17, 1.4, 2.9, 0.2),
  f("cabbage", "Cabbage", "Varză", "veg", 25, 1.3, 5.8, 0.1),
  f("cauliflower", "Cauliflower", "Conopidă", "veg", 25, 1.9, 5, 0.3),
  f("green-beans", "Green beans", "Fasole verde", "veg", 31, 1.8, 7, 0.2),
  f("peas", "Peas", "Mazăre", "veg", 81, 5.4, 14, 0.4),
  f("mushrooms", "Mushrooms", "Ciuperci", "veg", 22, 3.1, 3.3, 0.3),
  f("beetroot", "Beetroot", "Sfeclă roșie", "veg", 43, 1.6, 10, 0.2),
  f("aubergine", "Aubergine", "Vinete", "veg", 25, 1, 6, 0.2),
  f("sweetcorn", "Sweetcorn", "Porumb", "veg", 86, 3.3, 19, 1.4),
  f("lettuce", "Lettuce", "Salată verde", "veg", 15, 1.4, 2.9, 0.2),
  f("garlic", "Garlic", "Usturoi", "veg", 149, 6.4, 33, 0.5),
  f("pear", "Pear", "Pară", "fruit", 57, 0.4, 15, 0.1),
  f("peach", "Peach", "Piersică", "fruit", 39, 0.9, 9.5, 0.3),
  f("watermelon", "Watermelon", "Pepene roșu", "fruit", 30, 0.6, 7.6, 0.2),
  f("cherries", "Cherries", "Cireșe", "fruit", 63, 1.1, 16, 0.2),
  f("yogurt-plain", "Plain yogurt 3.5%", "Iaurt simplu 3,5%", "dairy", 61, 3.5, 4.7, 3.3),
  f("cascaval", "Cașcaval cheese", "Cașcaval", "dairy", 350, 25, 2, 27),
  f("sour-cream", "Sour cream 20%", "Smântână 20%", "dairy", 200, 2.8, 3.4, 20),
  f("chicken-ham", "Chicken ham", "Șuncă de pui", "protein", 105, 17, 2, 3),
  f("tofu", "Tofu", "Tofu", "protein", 76, 8, 1.9, 4.8),
  f("sunflower-seeds", "Sunflower seeds", "Semințe de floarea-soarelui", "fat", 584, 21, 20, 51),
  f("dark-chocolate", "Dark chocolate 70%", "Ciocolată neagră 70%", "fat", 598, 7.8, 46, 43),
  f("honey", "Honey", "Miere", "carbs", 304, 0.3, 82, 0),

  // fats
  f("olive-oil", "Olive oil", "Ulei de măsline", "fat", 884, 0, 0, 100),
  f("sunflower-oil", "Sunflower oil", "Ulei de floarea-soarelui", "fat", 884, 0, 0, 100),
  f("butter", "Butter", "Unt", "fat", 717, 0.9, 0.1, 81),
  f("almonds", "Almonds", "Migdale", "fat", 579, 21, 22, 50),
  f("walnuts", "Walnuts", "Nuci", "fat", 654, 15, 14, 65),
  f("peanut-butter", "Peanut butter", "Unt de arahide", "fat", 588, 25, 20, 50),
  f("avocado", "Avocado", "Avocado", "fat", 160, 2, 8.5, 15),
];

export function searchDemoFoods(q: string): DemoFood[] {
  return demoFoods.filter((food) => matchesQuery(`${food.name_en} ${food.name_ro}`, q));
}

// ---------- serving sizes ----------

export type FoodPortion = {
  /** Chip label, kept short: "M", "1 slice". */
  label: string;
  grams: number;
  /** Shown on hover — says where the number comes from. */
  note: string;
};

// Foods bought by the piece, not weighed. Egg grades are the EU scale, and the
// grams are EDIBLE weight: the shell is about 11% of a graded egg and nobody
// eats it, so an EU "large" (63-73 g in the box) logs as ~58 g.
//
// Keyed by demo food id, with a keyword fallback for live rows, which arrive
// from Open Food Facts with ids this table has never seen.
const PORTIONS: Record<string, FoodPortion[]> = {
  egg: [
    { label: "S", grams: 44, note: "small, under 53 g with shell" },
    { label: "M", grams: 50, note: "medium, 53-63 g with shell" },
    { label: "L", grams: 58, note: "large, 63-73 g with shell" },
    { label: "XL", grams: 66, note: "very large, over 73 g with shell" },
  ],
  "egg-white": [
    { label: "S", grams: 28, note: "white of a small egg" },
    { label: "M", grams: 33, note: "white of a medium egg" },
    { label: "L", grams: 38, note: "white of a large egg" },
  ],
  banana: [
    { label: "S", grams: 90, note: "small, peeled" },
    { label: "M", grams: 118, note: "medium, peeled" },
    { label: "L", grams: 136, note: "large, peeled" },
  ],
  apple: [
    { label: "S", grams: 105, note: "small, cored" },
    { label: "M", grams: 138, note: "medium, cored" },
    { label: "L", grams: 172, note: "large, cored" },
  ],
  orange: [
    { label: "S", grams: 96, note: "small, peeled" },
    { label: "M", grams: 131, note: "medium, peeled" },
    { label: "L", grams: 184, note: "large, peeled" },
  ],
  "bread-wholegrain": [
    { label: "1 slice", grams: 35, note: "standard sandwich slice" },
    { label: "2 slices", grams: 70, note: "two standard slices" },
  ],
  "peanut-butter": [
    { label: "1 tsp", grams: 6, note: "level teaspoon" },
    { label: "1 tbsp", grams: 16, note: "level tablespoon" },
  ],
  "olive-oil": [
    { label: "1 tsp", grams: 5, note: "level teaspoon" },
    { label: "1 tbsp", grams: 14, note: "level tablespoon" },
  ],
  "sunflower-oil": [
    { label: "1 tsp", grams: 5, note: "level teaspoon" },
    { label: "1 tbsp", grams: 14, note: "level tablespoon" },
  ],
  butter: [
    { label: "1 tsp", grams: 5, note: "level teaspoon" },
    { label: "1 tbsp", grams: 14, note: "level tablespoon" },
  ],
  avocado: [
    { label: "half", grams: 100, note: "half a medium avocado" },
    { label: "whole", grams: 200, note: "one medium avocado" },
  ],
};

// Matched against the food name when the id is unknown, so a live "Ou de gaina"
// or "Free range eggs" still offers sizes.
const KEYWORD_PORTIONS: { match: RegExp; key: string }[] = [
  // Order matters: "egg white" must be tested before the bare "egg".
  // Patterns run against already-normalised text, so no /i and no diacritics.
  { match: /\b(egg whites?|albus|albusuri)\b/, key: "egg-white" },
  { match: /\b(eggs?|ou|oua|oualor)\b/, key: "egg" },
  { match: /\b(bananas?|banana|banane)\b/, key: "banana" },
  { match: /\b(apples?|mar|mere)\b/, key: "apple" },
  { match: /\b(oranges?|portocala|portocale)\b/, key: "orange" },
  { match: /\b(bread|paine|painea)\b/, key: "bread-wholegrain" },
];

/**
 * Serving sizes for a food, or an empty list when it is only ever weighed.
 * Falls back to a keyword match so foods that did not come from this table
 * still get sizes where the name makes it obvious.
 */
export function portionsFor(food: {
  id: string;
  name_en: string;
  name_ro: string;
  portions?: FoodPortion[];
}): FoodPortion[] {
  // A row that carries its own servings wins: those are either curated in the
  // database or imported from this product's own label, both closer to the
  // truth than a keyword guess made here.
  if (food.portions && food.portions.length > 0) return food.portions;
  const byId = PORTIONS[food.id];
  if (byId) return byId;
  const haystack = normalizeForSearch(`${food.name_en} ${food.name_ro}`);
  const hit = KEYWORD_PORTIONS.find((entry) => entry.match.test(haystack));
  return hit ? PORTIONS[hit.key] : [];
}

// ---------- barcodes ----------

// Demo mode has no `foods` table and no network, so the scanner needs
// something to resolve against. These are real EAN-13 codes for products that
// match the generic entries closely enough to demo with; a live install
// resolves against `foods.barcode` and then Open Food Facts.
const BARCODES: Record<string, string> = {
  "5941234567890": "oats",
  "4008400402222": "peanut-butter",
  "5000112637922": "rice-cooked",
  "8076809513692": "pasta-cooked",
  "3017620422003": "peanut-butter",
  "5941070000091": "milk-15",
  "5941299000018": "telemea",
  "20057251": "egg",
  "5900951017667": "tuna-can",
  "8410076472115": "olive-oil",
};

/** Resolve a scanned code against the demo table, or null. */
export function findDemoFoodByBarcode(code: string): DemoFood | null {
  const id = BARCODES[code.trim()];
  if (!id) return null;
  return demoFoods.find((f) => f.id === id) ?? null;
}

/** Codes a tester can type in when there is no camera to point at anything. */
export function demoBarcodeSamples(): { code: string; name: string }[] {
  return Object.entries(BARCODES)
    .map(([code, id]) => ({ code, name: demoFoods.find((f) => f.id === id)?.name_ro ?? id }))
    .filter((entry, index, all) => all.findIndex((e) => e.name === entry.name) === index)
    .slice(0, 5);
}
