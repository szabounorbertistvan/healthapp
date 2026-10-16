// A scanned product that is plainly an ingredient — oats, yogurt, chicken breast,
// olive oil — should link to DishFinder like a USDA row does, so the meal it is
// logged in can open "recipes with these ingredients". Open Food Facts tags every
// product with categories (`categories_tags`, general → specific, e.g.
// ["en:plant-based-foods", "en:cereals-and-potatoes", "en:cereals", "en:flakes",
// "en:rolled-oats"]); this maps the ones that are an ingredient to DishFinder's
// ingredient id. Prepared foods (a chocolate cereal, a ready meal) carry no
// mapped tag and stay unlinked — a vague link is worse than none.
//
// Used by the barcode-lookup and food-search edge functions at cache time, and by
// scripts/backfill-off-dishfinder.mjs for products cached before this existed.
// Ids are DishFinder `ingredients.id` (stable; see docs/DISHFINDER.md).

/** OFF category tag → DishFinder ingredient id. Most specific tag wins. */
export const OFF_TO_DISHFINDER: Record<string, number> = {
  // grains, cereals
  "en:rolled-oats": 3400, "en:oat-flakes": 3400, "en:oats": 3399, "en:oatmeals": 3399,
  "en:rices": 3379, "en:white-rices": 3379, "en:basmati-rices": 3382, "en:brown-rices": 3381, "en:whole-grain-rices": 3381,
  "en:pastas": 3437, "en:dry-pastas": 3437, "en:spaghetti": 3437, "en:penne": 3437, "en:fusilli": 3437,
  "en:quinoa": 3390, "en:buckwheat": 3405, "en:couscous": 3394, "en:bulgur": 3393,
  "en:polenta": 3427, "en:cornmeal": 3426, "en:semolina": 3419, "en:wheat-flours": 3412, "en:flours": 3412, "en:rice-flours": 3389,
  "en:rice-noodles": 3466, "en:noodles": 4125,
  "en:breads": 3480, "en:wholemeal-breads": 3482, "en:whole-wheat-breads": 3482, "en:sliced-breads": 3480,
  "en:corn-flakes": 4455, "en:mueslis": 4612, "en:granolas": 4389,
  // dairy and eggs
  "en:milks": 3293, "en:cow-milks": 3293, "en:whole-milks": 3293, "en:semi-skimmed-milks": 3293, "en:skimmed-milks": 3293, "en:uht-milks": 3293,
  "en:yogurts": 3316, "en:plain-yogurts": 3318, "en:natural-yogurts": 3318, "en:greek-yogurts": 3317, "en:strained-yogurts": 3317, "en:skyr": 3321,
  "en:kefirs": 3319, "en:cream-cheeses": 3349, "en:sour-creams": 3302, "en:creams": 4890, "en:whipping-creams": 4890,
  "en:cottage-cheeses": 4580, "en:mozzarella": 3326, "en:cheddar": 3323, "en:feta": 3346, "en:parmigiano-reggiano": 3329, "en:parmesan": 3329, "en:telemea": 4235,
  "en:butters": 3310, "en:eggs": 3375, "en:chicken-eggs": 3375, "en:free-range-chicken-eggs": 3375,
  // plant milks
  "en:oat-milks": 3968, "en:almond-milks": 3965, "en:soy-milks": 3967, "en:coconut-milks": 3959,
  // meat and fish
  "en:chicken-breasts": 3129, "en:chicken-breast-fillets": 3129, "en:turkey-breasts": 3138, "en:hams": 4457, "en:bacons": 3182, "en:sausages": 3193,
  "en:ground-beef": 3158, "en:minced-beef": 3158, "en:beef": 4302, "en:pork": 4301,
  "en:tunas": 3227, "en:canned-tunas": 3227, "en:tuna-in-water": 3227, "en:salmons": 3222, "en:smoked-salmons": 3222, "en:sardines": 3247, "en:canned-sardines": 3247, "en:mackerels": 3251, "en:shrimps": 3260,
  // legumes, soy
  "en:lentils": 3517, "en:red-lentils": 3518, "en:chickpeas": 3524, "en:canned-chickpeas": 3524, "en:black-beans": 3526, "en:tofu": 3550, "en:hummus": 3864,
  // nuts, seeds, spreads
  "en:almonds": 3564, "en:walnuts": 3565, "en:cashew-nuts": 3566, "en:hazelnuts": 3567, "en:peanuts": 3576,
  "en:peanut-butters": 3577, "en:almond-butters": 3575, "en:tahini": 3580, "en:chia-seeds": 3584, "en:pumpkin-seeds": 3583, "en:sunflower-seeds": 3582,
  // fruit and vegetables (packaged: dried, canned, frozen plain)
  "en:bananas": 3071, "en:apples": 3069, "en:raisins": 3110, "en:dates": 3108, "en:olives": 3056, "en:pickles": 3061,
  "en:sweetcorn": 3000, "en:canned-sweetcorn": 3000, "en:peas": 2997, "en:green-beans": 2995, "en:spinachs": 2966, "en:potatoes": 4091, "en:sweet-potatoes": 4076,
  "en:tomato-pastes": 3798, "en:tomato-purees": 3798,
  // fats, sweeteners, condiments that are one ingredient
  "en:olive-oils": 3759, "en:extra-virgin-olive-oils": 3759, "en:virgin-olive-oils": 3759, "en:sunflower-oils": 3763, "en:coconut-oils": 3764,
  "en:honeys": 3923, "en:maple-syrups": 3926, "en:sugars": 3905, "en:white-sugars": 3905, "en:jams": 4399,
  "en:ketchup": 3811, "en:mustards": 3823, "en:mayonnaises": 3831,
  "en:cocoa-powders": 4015, "en:dark-chocolates": 4018,
  // from the first backfill's unmapped report (2026-10-13)
  "en:romaine-lettuce": 2981, "en:lettuces": 2980, "en:cabbages": 2971, "en:red-cabbage": 2972, "en:hearts-of-palm": 3009,
  "en:edamame": 3547, "en:frozen-edamame": 3547, "en:textured-soy-protein": 3558,
  "en:chickens": 4126, "en:chicken-wings": 3132, "en:whole-chickens": 3134, "en:white-hams": 4457, "en:pork-pates": 4877,
  "en:soy-sauces": 3769, "en:plain-popcorn": 5230,
  // supplements
  "en:whey-proteins": 4083, "en:protein-powders": 4083,
  "en:orange-juices": 3989, "en:waters": 3945, "en:mineral-waters": 3945, "en:spring-waters": 3945,
};

/**
 * Tags that mark a product as flavoured, sweetened or otherwise not the plain
 * ingredient its parent category suggests. Any of these → no link: a chocolate
 * milk is not "milk" in a recipe, a chocolate cereal is not oats.
 */
const NOT_PLAIN = new Set([
  "en:flavoured-milks", "en:chocolate-milks", "en:milkshakes", "en:flavoured-yogurts", "en:fruit-yogurts", "en:sweetened-yogurts",
  "en:dessert-yogurts", "en:chocolate-cereals", "en:sweetened-cereals", "en:filled-cereals", "en:cereal-bars", "en:chocolate-bars",
  "en:spreads-with-chocolate", "en:chocolate-spreads", "en:sweetened-beverages", "en:flavoured-waters", "en:breaded-products",
  "en:marinated-meats", "en:prepared-meats", "en:meals", "en:prepared-meals", "en:ready-meals", "en:sandwiches", "en:pizzas",
  "en:biscuits", "en:cakes", "en:pastries", "en:desserts", "en:ice-creams", "en:confectioneries", "en:candies", "en:sweet-spreads",
]);

/**
 * When a product carries no categories at all (crowd-sourced data; "Iaurt" from a
 * Romanian shelf has none), the name is the only signal. Deliberately narrow: the
 * whole normalised name must BE one of these plain forms — "iaurt" links,
 * "iaurt de băut cu căpșuni" does not, because a flavoured drink is not yogurt
 * in a recipe. Romanian and English, accents stripped, lower-case.
 */
const PLAIN_NAMES: Record<string, number> = {
  "iaurt": 3316, "iaurt natural": 3318, "yogurt": 3316, "yoghurt": 3316, "natural yogurt": 3318, "plain yogurt": 3318,
  "iaurt grecesc": 3317, "greek yogurt": 3317, "skyr": 3321, "kefir": 3319, "chefir": 3319,
  "lapte": 3293, "milk": 3293, "lapte de vaca": 3293, "unt": 3310, "butter": 3310, "smantana": 3302, "sour cream": 3302,
  "oua": 3375, "eggs": 3375, "branza de vaci": 4580, "cottage cheese": 4580, "telemea": 4235, "mozzarella": 3326, "parmezan": 3329, "parmesan": 3329,
  "fulgi de ovaz": 3400, "ovaz": 3399, "oats": 3399, "rolled oats": 3400, "oat flakes": 3400,
  "orez": 3379, "rice": 3379, "orez basmati": 3382, "basmati rice": 3382, "orez brun": 3381, "brown rice": 3381,
  "paste": 3437, "pasta": 3437, "spaghete": 3437, "spaghetti": 3437, "quinoa": 3390, "hrisca": 3405, "buckwheat": 3405, "cuscus": 3394, "couscous": 3394,
  "linte": 3517, "lentils": 3517, "naut": 3524, "chickpeas": 3524, "tofu": 3550,
  "piept de pui": 3129, "chicken breast": 3129, "piept de curcan": 3138, "turkey breast": 3138, "ton": 3227, "tuna": 3227, "somon": 3222, "salmon": 3222,
  "ulei de masline": 3759, "olive oil": 3759, "ulei de floarea soarelui": 3763, "sunflower oil": 3763, "ulei de cocos": 3764, "coconut oil": 3764,
  "miere": 3923, "honey": 3923, "unt de arahide": 3577, "peanut butter": 3577, "migdale": 3564, "almonds": 3564, "nuci": 3565, "walnuts": 3565,
  "banane": 3071, "banana": 3071, "mere": 3069, "apples": 3069, "stafide": 3110, "raisins": 3110, "curmale": 3108, "dates": 3108,
  "proteina din zer": 4083, "whey protein": 4083, "whey": 4083, "cacao": 4015, "cocoa powder": 4015, "ciocolata neagra": 4018, "dark chocolate": 4018,
  "apa": 3945, "water": 3945, "apa minerala": 3945, "mineral water": 3945,
  // plan + log foods still unlinked on 2026-10-16 (no OFF categories)
  "soy protein": 4511, "soy protein isolate": 4511, "proteina de soia": 4511, "izolat proteic din soia": 4511,
  "focaccia": 3487, "foccacia": 3487, "branza de burduf": 4477, "burduf": 4477,
  "sunca de curcan": 5045, "sunca din piept de curcan": 5045, "turkey ham": 5045,
};

/**
 * Tags whose food IS a prepared meat in DishFinder too (a pâté, a ham): OFF files
 * them under `en:prepared-meats`, which would otherwise veto every one. Only that
 * veto is lifted, and only when one of these is the tag that maps.
 */
const PREPARED_MEAT_INGREDIENTS = new Set(["en:pork-pates", "en:hams", "en:white-hams", "en:bacons", "en:sausages"]);

const normalizeName = (name: unknown): string =>
  typeof name === "string"
    ? name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim()
    : "";

/**
 * The DishFinder ingredient for a scanned product, or null when it is not plainly
 * one ingredient. Categories first: most specific tag wins (OFF lists general →
 * specific, so scan from the end), and a flavoured/prepared tag vetoes (bar
 * `en:prepared-meats` on a pâté or ham, see PREPARED_MEAT_INGREDIENTS). Only when
 * the product carries no categories at all does the bare product name count, and
 * only as one of PLAIN_NAMES in full.
 */
export function dishfinderIdFromOff(categoriesTags: unknown, productName?: unknown): number | null {
  const tags = Array.isArray(categoriesTags) ? categoriesTags.filter((t): t is string => typeof t === "string") : [];
  if (tags.length > 0) {
    for (let i = tags.length - 1; i >= 0; i--) {
      const id = OFF_TO_DISHFINDER[tags[i]];
      if (!id) continue;
      const lifted = PREPARED_MEAT_INGREDIENTS.has(tags[i]) ? "en:prepared-meats" : null;
      return tags.some((t) => NOT_PLAIN.has(t) && t !== lifted) ? null : id;
    }
    return null;
  }
  return PLAIN_NAMES[normalizeName(productName)] ?? null;
}
