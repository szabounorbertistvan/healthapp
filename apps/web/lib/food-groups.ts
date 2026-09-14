// Food groups for the small icon next to a food in the pickers.
//
// Rows from the USDA import and Open Food Facts carry no group, so it is
// read off the name with a keyword
// pass over the normalised text — the same lower-case, unaccented form the
// search uses, so Romanian plurals and diacritics need no special cases here.
// A miss falls back to a neutral plate. This is a display hint only: nothing
// downstream (macros, adherence, plans) reads it.
import { normalizeForSearch } from "@healthapp/shared";

export type FoodGroup =
  | "protein"
  | "dairy"
  | "carbs"
  | "fat"
  | "fruit"
  | "veg"
  | "sweets"
  | "drink"
  | "other";

export const FOOD_GROUPS: readonly FoodGroup[] = [
  "protein", "dairy", "carbs", "fat", "fruit", "veg", "sweets", "drink", "other",
];

export const FOOD_GROUP_ICON: Record<FoodGroup, string> = {
  protein: "🍗",
  dairy: "🥛",
  carbs: "🍞",
  fat: "🥑",
  fruit: "🍎",
  veg: "🥦",
  sweets: "🍫",
  drink: "🥤",
  other: "🍽️",
};

// Order matters: the first rule that matches wins. Drinks and sweets go first
// because their names often contain a base ingredient ("orange juice",
// "milk chocolate"); fats before dairy so "peanut butter" and "butter" are
// fats; protein before dairy so "whey" lands with protein.
const RULES: { group: FoodGroup; match: RegExp }[] = [
  { group: "drink", match: /\b(juice|suc|cola|soda|lemonade|limonada|water|apa|coffee|cafea|latte|cappuccino|tea|ceai|beer|bere|wine|vin|drink|bautura|bauturi|smoothie|shake|kombucha)\b/ },
  { group: "sweets", match: /\b(chocolate|ciocolata|cookies?|biscuits?|biscuiti|cake|tort|prajitur\w*|candy|bomboane|ice cream|inghetata|croissant|donuts?|gogos\w*|jam|gem|dulceata|sugar|zahar|honey|miere|halva|wafers?|napolitan\w*|pudding|budinca|dessert|desert|sweets?|dulciuri|syrup|sirop|nutella|caramel)\b/ },
  { group: "fat", match: /\b(oil|ulei|butter|unt|margarin\w*|nuts?|nuci|almonds?|migdale|walnuts?|hazelnuts?|alune|peanuts?|arahide|cashews?|caju|pistachio\w*|fistic|seeds?|seminte|avocado|mayonnaise|maioneza|tahini|olives?|masline|lard|untura|slanina|bacon|chia|flax|in)\b/ },
  { group: "protein", match: /\b(chicken|pui|turkey|curcan|beef|vita|vaca|pork|porc|lamb|miel|fish|peste|salmon|somon|tuna|ton|cod|trout|pastrav|mackerel|macrou|sardines?|sardine|shrimp|creveti|eggs?|ou|oua|albus|albusuri|tofu|whey|protein\w*|proteina|proteine|ham|sunca|sausages?|carnati|mince|tocata|steak|meat|carne|liver|ficat|salami|prosciutto|tempeh|seitan)\b/ },
  { group: "dairy", match: /\b(milk|lapte|yogh?urt|iaurt|cheese|branza|cascaval|telemea|urda|kefir|chefir|sana|cream|smantana|frisca|cottage|mozzarella|feta|parmesan|ricotta|skyr|quark|lactate)\b/ },
  { group: "fruit", match: /\b(apples?|mar|mere|bananas?|banane|oranges?|portocal\w*|grapes?|struguri|berry|berries|afine|capsuni|zmeura|strawberr\w*|raspberr\w*|blueberr\w*|cherr\w*|cirese|visine|peach\w*|piersic\w*|pears?|par[ae]|pere|plums?|prun[ae]|melon|pepene|watermelon|mango|pineapple|ananas|kiwi|lemon|lamaie|grapefruit|apricots?|caise|figs?|smochine|dates?|curmale|raisins?|stafide|fruits?|fructe?|pomegranate|rodie|nectarine?)\b/ },
  { group: "veg", match: /\b(broccoli|spinach|spanac|tomato\w*|rosii|rosie|cucumbers?|castravet\w*|peppers?|ardei|carrots?|morcov\w*|onions?|ceapa|zucchini|dovlecel|dovlecei|salad|salata|lettuce|cabbage|varza|cauliflower|conopida|beans?|fasole|peas|mazare|mushrooms?|ciuperci|beet\w*|sfecla|aubergine|eggplant|vinete|corn|porumb|garlic|usturoi|celery|telina|leek|praz|kale|pumpkin|dovleac|radish\w*|ridichi|vegetables?|legume|asparagus|sparanghel|artichoke|anghinare|pickles?|muraturi)\b/ },
  { group: "carbs", match: /\b(rice|orez|pasta|paste|spaghetti|macaroni|noodles?|taitei|bread|paine|oats?|ovaz|potato\w*|cartof\w*|polenta|mamaliga|malai|flour|faina|quinoa|buckwheat|hrisca|lentils?|linte|chickpeas?|naut|couscous|bulgur|cereals?|cereale|granola|musli|muesli|tortilla|lipie|bagel|crackers?|pizza|pita|wrap|cornflakes|barley|orz|millet|mei|gnocchi|dumplings?|galuste|pancakes?|clatite|waffles?)\b/ },
];

/**
 * The group of a food: its own `group` when the table set one, else a keyword
 * guess from the name(s), else `other`.
 */
export function foodGroupOf(food: {
  group?: string | null;
  name_en?: string | null;
  name_ro?: string | null;
  name?: string | null;
}): FoodGroup {
  if (food.group && (FOOD_GROUPS as readonly string[]).includes(food.group)) return food.group as FoodGroup;
  const text = normalizeForSearch([food.name_en, food.name_ro, food.name].filter(Boolean).join(" "));
  if (!text) return "other";
  for (const rule of RULES) if (rule.match.test(text)) return rule.group;
  return "other";
}
