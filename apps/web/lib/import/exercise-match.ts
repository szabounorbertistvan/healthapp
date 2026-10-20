// Matching another app's exercise names to rows of our library.
//
// Hevy and Strong name lifts "Bench Press (Barbell)"; the library (Free
// Exercise DB) says "Barbell Bench Press - Medium Grip". Both are reduced to a
// bag of canonical words — lower case, no accents, plurals and spellings
// folded ("Pull-Ups" = "pullup", "DB" = "dumbbell"), the equipment in brackets
// counted as words — and compared:
//
// 1. the same bag as one of the person's own exercises, then as a library row;
// 2. an alias: the most common Hevy/Strong names whose library row the words
//    alone would not find, written once below;
// 3. a close enough bag (Dice ≥ AUTO_SCORE, every word of the name in it,
//    and the best by a margin).
//
// Anything else is unmatched and goes to the review step with suggestions.
// A wrong automatic match is worse than a question — it files years of a
// lift's history under another lift — so the bar is high on purpose.

export type LibraryExercise = {
  id: string;
  name_en: string;
  name_ro: string | null;
  equipment: string | null;
  /** The person's own custom exercise. */
  mine: boolean;
};

export type ExerciseMatch = {
  /** The library row picked automatically, or null for the review step. */
  exerciseId: string | null;
  /** Closest rows, best first — the review step's shortlist. */
  suggestions: string[];
};

const AUTO_SCORE = 0.85;

/** Phrases that are one word in one app and two in another. */
const PHRASES: [RegExp, string][] = [
  [/\bpull[\s-]?ups?\b/g, "pullup"],
  [/\bchin[\s-]?ups?\b/g, "chinup"],
  [/\bpush[\s-]?ups?\b/g, "pushup"],
  [/\bsit[\s-]?ups?\b/g, "situp"],
  [/\bstep[\s-]?ups?\b/g, "stepup"],
  [/\bskull[\s-]?crushers?\b/g, "skullcrusher"],
  [/\bpull[\s-]?downs?\b/g, "pulldown"],
  [/\bpush[\s-]?downs?\b/g, "pushdown"],
  [/\be-?z[\s-]?(curl\s)?bar\b/g, "ezbar"],
  [/\bbody[\s-]?(weight|only)\b/g, "bodyweight"],
  [/\bsmith machine\b/g, "smith"],
  [/\bt[\s-]bar\b/g, "tbar"],
  [/\bstiff[\s-]legg?e?d?\b/g, "stiffleg"],
];

const WORDS: Record<string, string> = {
  db: "dumbbell", dumbbells: "dumbbell", bb: "barbell", kb: "kettlebell", kettlebells: "kettlebell",
  bands: "band", biceps: "bicep", triceps: "tricep", flyes: "fly", flye: "fly", flies: "fly",
  leverage: "machine", other: "", lbs: "", the: "", a: "", with: "", on: "", of: "", to: "", and: "", "": "",
};

/** The canonical word bag of a name (plus, optionally, an equipment string). */
export function nameTokens(name: string, equipment?: string | null): Set<string> {
  let s = `${name} ${equipment ?? ""}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  const out = new Set<string>();
  for (const raw of s.split(/[^a-z0-9]+/)) {
    const w = singular(WORDS[raw] ?? raw);
    if (w) out.add(WORDS[w] ?? w);
  }
  return out;
}

/** "curls" = "curl", "crunches" = "crunch", "presses" = "press" — and "press" stays. */
function singular(w: string): string {
  if (w.length <= 3 || !w.endsWith("s") || w.endsWith("ss")) return w;
  if (/(ch|sh|ss|x)es$/.test(w)) return w.slice(0, -2);
  return w.slice(0, -1);
}

const bagKey = (bag: Set<string>) => [...bag].sort().join(" ");

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return (2 * both) / (a.size + b.size);
}

/**
 * Common Hevy / Strong names → the library row's name_en, for the lifts the
 * words alone would not match (or would match to a variant). Keys are read
 * through nameTokens, so "Bench Press (Barbell)" also covers "Barbell Bench
 * Press" and "bench press - barbell".
 */
const ALIASES: [string, string][] = [
  ["Bench Press (Barbell)", "Barbell Bench Press - Medium Grip"],
  ["Bench Press", "Barbell Bench Press - Medium Grip"],
  ["Bench Press (Smith Machine)", "Smith Machine Bench Press"],
  ["Chest Press (Machine)", "Machine Bench Press"],
  ["Bench Press (Machine)", "Machine Bench Press"],
  ["Incline Bench Press (Barbell)", "Barbell Incline Bench Press - Medium Grip"],
  ["Incline Bench Press (Dumbbell)", "Incline Dumbbell Press"],
  ["Decline Bench Press (Barbell)", "Decline Barbell Bench Press"],
  ["Close Grip Bench Press (Barbell)", "Close-Grip Barbell Bench Press"],
  ["Squat (Barbell)", "Barbell Squat"],
  ["Back Squat (Barbell)", "Barbell Squat"],
  ["Squat", "Barbell Squat"],
  ["Front Squat (Barbell)", "Front Barbell Squat"],
  ["Front Squat", "Front Barbell Squat"],
  ["Hack Squat (Machine)", "Hack Squat"],
  ["Deadlift (Barbell)", "Barbell Deadlift"],
  ["Deadlift", "Barbell Deadlift"],
  ["Sumo Deadlift (Barbell)", "Sumo Deadlift"],
  ["Romanian Deadlift (Barbell)", "Romanian Deadlift"],
  ["Romanian Deadlift (Dumbbell)", "Stiff-Legged Dumbbell Deadlift"],
  ["Stiff Leg Deadlift (Barbell)", "Stiff-Legged Barbell Deadlift"],
  ["Trap Bar Deadlift", "Trap Bar Deadlift"],
  ["Overhead Press (Barbell)", "Standing Military Press"],
  ["Strict Military Press (Barbell)", "Standing Military Press"],
  ["Military Press (Barbell)", "Standing Military Press"],
  ["Overhead Press (Dumbbell)", "Dumbbell Shoulder Press"],
  ["Shoulder Press (Dumbbell)", "Dumbbell Shoulder Press"],
  ["Seated Shoulder Press (Dumbbell)", "Dumbbell Shoulder Press"],
  ["Shoulder Press (Machine)", "Machine Shoulder (Military) Press"],
  ["Arnold Press (Dumbbell)", "Arnold Dumbbell Press"],
  ["Pull Up", "Pullups"],
  ["Pull Up (Weighted)", "Pullups"],
  ["Pull Up (Assisted)", "Band Assisted Pull-Up"],
  ["Chin Up", "Chin-Up"],
  ["Chin Up (Weighted)", "Chin-Up"],
  ["Lat Pulldown (Cable)", "Wide-Grip Lat Pulldown"],
  ["Lat Pulldown (Machine)", "Wide-Grip Lat Pulldown"],
  ["Lat Pulldown - Close Grip (Cable)", "Close-Grip Front Lat Pulldown"],
  ["Straight Arm Pulldown (Cable)", "Straight-Arm Pulldown"],
  ["Seated Cable Row - V Grip (Cable)", "Seated Cable Rows"],
  ["Seated Row (Cable)", "Seated Cable Rows"],
  ["Seated Cable Row", "Seated Cable Rows"],
  ["Bent Over Row (Barbell)", "Bent Over Barbell Row"],
  ["Pendlay Row (Barbell)", "Bent Over Barbell Row"],
  ["Bent Over Row (Dumbbell)", "Bent Over Two-Dumbbell Row"],
  ["Dumbbell Row", "One-Arm Dumbbell Row"],
  ["Single Arm Dumbbell Row", "One-Arm Dumbbell Row"],
  ["T Bar Row", "T-Bar Row with Handle"],
  ["Bicep Curl (Barbell)", "Barbell Curl"],
  ["Bicep Curl (Dumbbell)", "Dumbbell Bicep Curl"],
  ["Hammer Curl (Dumbbell)", "Hammer Curls"],
  ["EZ Bar Biceps Curl", "EZ-Bar Curl"],
  ["Bicep Curl (EZ Bar)", "EZ-Bar Curl"],
  ["Preacher Curl (Barbell)", "Preacher Curl"],
  ["Preacher Curl (Dumbbell)", "One Arm Dumbbell Preacher Curl"],
  ["Preacher Curl (Machine)", "Machine Preacher Curls"],
  ["Concentration Curl", "Concentration Curls"],
  ["Triceps Pushdown (Cable)", "Triceps Pushdown"],
  ["Triceps Pushdown (Cable - Straight Bar)", "Triceps Pushdown"],
  ["Triceps Rope Pushdown", "Triceps Pushdown - Rope Attachment"],
  ["Triceps Pushdown (Rope)", "Triceps Pushdown - Rope Attachment"],
  ["Skullcrusher (Barbell)", "EZ-Bar Skullcrusher"],
  ["Skullcrusher (EZ Bar)", "EZ-Bar Skullcrusher"],
  ["Triceps Extension (Cable)", "Cable Rope Overhead Triceps Extension"],
  ["Overhead Triceps Extension (Cable)", "Cable Rope Overhead Triceps Extension"],
  ["Triceps Kickback (Dumbbell)", "Tricep Dumbbell Kickback"],
  ["Triceps Dip", "Dips - Triceps Version"],
  ["Triceps Dip (Bodyweight)", "Dips - Triceps Version"],
  ["Dip", "Dips - Triceps Version"],
  ["Chest Dip", "Dips - Chest Version"],
  ["Leg Press (Machine)", "Leg Press"],
  ["Leg Extension (Machine)", "Leg Extensions"],
  ["Lying Leg Curl (Machine)", "Lying Leg Curls"],
  ["Seated Leg Curl (Machine)", "Seated Leg Curl"],
  ["Hip Thrust (Barbell)", "Barbell Hip Thrust"],
  ["Lateral Raise (Dumbbell)", "Side Lateral Raise"],
  ["Face Pull (Cable)", "Face Pull"],
  ["Reverse Fly (Dumbbell)", "Reverse Flyes"],
  ["Rear Delt Reverse Fly (Machine)", "Reverse Machine Flyes"],
  ["Chest Fly (Dumbbell)", "Dumbbell Flyes"],
  ["Incline Chest Fly (Dumbbell)", "Incline Dumbbell Flyes"],
  ["Chest Fly (Machine)", "Butterfly"],
  ["Pec Deck (Machine)", "Butterfly"],
  ["Cable Fly Crossovers", "Cable Crossover"],
  ["Cable Crossover", "Cable Crossover"],
  ["Shrug (Barbell)", "Barbell Shrug"],
  ["Shrug (Dumbbell)", "Dumbbell Shrug"],
  ["Standing Calf Raise (Machine)", "Standing Calf Raises"],
  ["Standing Calf Raise", "Standing Calf Raises"],
  ["Calf Raise (Machine)", "Standing Calf Raises"],
  ["Seated Calf Raise (Machine)", "Seated Calf Raise"],
  ["Lunge (Dumbbell)", "Dumbbell Lunges"],
  ["Lunge (Barbell)", "Barbell Lunge"],
  ["Push Up", "Pushups"],
  ["Plank", "Plank"],
  ["Crunch", "Crunches"],
  ["Cable Crunch", "Cable Crunch"],
  ["Hanging Leg Raise", "Hanging Leg Raise"],
  ["Russian Twist", "Russian Twist"],
  ["Sit Up", "Sit-Up"],
  ["Ab Wheel", "Ab Roller"],
  ["Back Extension", "Hyperextensions (Back Extensions)"],
  ["Hyperextension", "Hyperextensions (Back Extensions)"],
  ["Good Morning (Barbell)", "Good Morning"],
  ["Farmers Walk", "Farmer's Walk"],
  ["Running", "Running, Treadmill"],
  ["Treadmill", "Running, Treadmill"],
  ["Cycling", "Bicycling, Stationary"],
  ["Rowing Machine", "Rowing, Stationary"],
  ["Elliptical Trainer", "Elliptical Trainer"],
  ["Stair Machine", "Stairmaster"],
  ["Power Clean", "Power Clean"],
  ["Clean and Jerk (Barbell)", "Clean and Jerk"],
  ["Snatch (Barbell)", "Snatch"],
];

const ALIAS_INDEX = new Map(ALIASES.map(([from, to]) => [bagKey(nameTokens(from)), to.toLowerCase()]));

export type MatchIndex = {
  library: readonly LibraryExercise[];
  bags: Set<string>[];
  byBag: Map<string, number>;
  byName: Map<string, number>;
};

/** Built once per library, reused for every name in the file. */
export function buildMatchIndex(library: readonly LibraryExercise[]): MatchIndex {
  const bags = library.map((e) => nameTokens(e.name_en, e.equipment));
  const byBag = new Map<string, number>();
  const byName = new Map<string, number>();
  // The person's own rows first, so their "Bench Press" wins over ours.
  const order = library.map((_, i) => i).sort((a, b) => Number(library[b]!.mine) - Number(library[a]!.mine));
  for (const i of order) {
    const e = library[i]!;
    for (const key of [bagKey(nameTokens(e.name_en)), bagKey(bags[i]!), e.name_ro ? bagKey(nameTokens(e.name_ro)) : ""]) {
      if (key && !byBag.has(key)) byBag.set(key, i);
    }
    const lower = e.name_en.toLowerCase();
    if (!byName.has(lower)) byName.set(lower, i);
  }
  return { library, bags, byBag, byName };
}

export function matchExercise(name: string, index: MatchIndex): ExerciseMatch {
  const bag = nameTokens(name);
  const key = bagKey(bag);
  const scored = index.bags
    .map((b, i) => ({ i, score: dice(bag, b) }))
    .filter((x) => x.score > 0.25)
    .sort((a, b) => b.score - a.score || index.library[a.i]!.name_en.length - index.library[b.i]!.name_en.length)
    .slice(0, 6);
  const suggestions = scored.map((x) => index.library[x.i]!.id);
  const pick = (i: number | undefined): ExerciseMatch | null =>
    i === undefined ? null : { exerciseId: index.library[i]!.id, suggestions: [index.library[i]!.id, ...suggestions.filter((id) => id !== index.library[i]!.id)].slice(0, 6) };

  const exact = pick(index.byBag.get(key));
  if (exact) return exact;
  const alias = ALIAS_INDEX.get(key);
  const aliased = alias ? pick(index.byName.get(alias)) : null;
  if (aliased) return aliased;
  const [best, second] = scored;
  // Every word of the name must be in the row: "Bulgarian Split Squat" is not
  // "Split Squat", however close the bags are.
  const covers = (i: number) => [...bag].every((w) => index.bags[i]!.has(w));
  if (best && best.score >= AUTO_SCORE && covers(best.i) && (!second || best.score - second.score >= 0.05)) return pick(best.i)!;
  return { exerciseId: null, suggestions };
}
