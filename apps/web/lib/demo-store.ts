import { demoClients, demoDashboard, demoPrograms, demoProgramDetail, demoNutritionPlans } from "./demo";
import type { ClientRow, DashboardRow } from "./types";

// Mutable demo backend.
//
// Demo mode used to serve frozen fixtures, so the builders had nothing to write
// to. This store gives them a target with the same shape as the Postgres tables
// (programs → program_days → program_exercises, nutrition_plans →
// planned_meals → planned_meal_foods), which is what keeps the Supabase branch
// of lib/data.ts a straight swap rather than a rewrite.
//
// It lives in the server process: everything is lost when the dev server
// restarts. That is the trade for needing no Docker.

export type StoredProgramExercise = {
  id: string;
  exercise_id: string;
  exercise_name: string;
  position: number;
  target_sets: number;
  target_reps: string;
  target_weight_kg: number | null;
  target_rpe: number | null;
  rest_seconds: number | null;
  notes: string | null;
};

export type StoredProgramDay = {
  id: string;
  week_index: number;
  day_index: number;
  name: string;
  muscle_groups: string[];
  exercises: StoredProgramExercise[];
};

export type StoredProgram = {
  id: string;
  /**
   * null for a program the client built for themselves (programs_solo_all in
   * SQL requires exactly this combination). Every program in the original
   * seed is coach-authored, so this is the only signal that lets
   * getMySoloProgramId and createSoloProgram tell a solo program apart from
   * one the coach assigned — see task-6-report.md.
   */
  coach_id: string | null;
  client_id: string;
  client_name: string;
  name: string;
  status: "draft" | "published" | "archived";
  intensity_mode: "rpe" | "rir" | "simple";
  weeks: number;
  updated_at: string;
  days: StoredProgramDay[];
};

/** Stand-in coach id for the seeded, coach-authored demo programs. */
export const DEMO_COACH_ID = "coach1";

export type StoredMealFood = {
  id: string;
  food_name: string;
  grams: number;
  per_100g: { kcal: number; protein: number; carbs: number; fat: number };
};

export type StoredMeal = {
  id: string;
  slot: "breakfast" | "lunch" | "dinner" | "snack";
  name: string;
  position: number;
  foods: StoredMealFood[];
};

export type StoredPlan = {
  id: string;
  client_id: string;
  client_name: string;
  name: string;
  status: "draft" | "published" | "archived";
  kcal_target: number;
  protein_target_g: number;
  carbs_target_g: number;
  fat_target_g: number;
  meals: StoredMeal[];
};

/** Superset of DashboardRow and ClientRow — demo keeps one row per client. */
export type StoredClient = DashboardRow & {
  status: "invited" | "active" | "ended";
  started_at: string | null;
};

type Store = { clients: StoredClient[]; programs: StoredProgram[]; plans: StoredPlan[] };

// Next.js hot-reloads modules in dev; without this the coach loses their work
// on every file save. The version stamp is what makes that safe: a store kept
// across a reload that added a field would otherwise be missing it, and every
// reader would crash on undefined. Bump it whenever Store changes shape.
const STORE_VERSION = 3;

const globalRef = globalThis as unknown as {
  __voinicDemoStore?: Store & { version?: number };
};

export function store(): Store {
  if (globalRef.__voinicDemoStore?.version !== STORE_VERSION) {
    globalRef.__voinicDemoStore = { ...seed(), version: STORE_VERSION };
  }
  return globalRef.__voinicDemoStore;
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Clients a program or plan can be assigned to — the coach's active roster. */
export function demoRoster(): { id: string; name: string }[] {
  return store()
    .clients.filter((c) => c.status === "active")
    .map((c) => ({ id: c.client_id, name: c.full_name }));
}

export function demoClientRows(): ClientRow[] {
  return store().clients.map((c) => ({
    client_id: c.client_id,
    full_name: c.full_name,
    signal: c.signal,
    overall_pct: c.overall_pct,
    last_activity: c.last_activity,
    status: c.status,
    started_at: c.started_at,
  }));
}

export function demoDashboardRows(): DashboardRow[] {
  return store().clients.filter((c) => c.status === "active");
}

/**
 * A client with no adherence snapshot yet. The signal mirrors what
 * coach_dashboard() returns in SQL — coalesce(a.signal, 'needs_attention') —
 * rather than inventing a friendlier default the server would not agree with.
 */
export function newDemoClient(fullName: string): StoredClient {
  return {
    client_id: newId("c"),
    full_name: fullName,
    avatar_url: null,
    signal: "needs_attention",
    reason: "No activity yet — first week has no snapshot",
    overall_pct: 0,
    last_activity: null,
    pending_checkin: false,
    unread_messages: 0,
    status: "active",
    started_at: new Date().toISOString(),
  };
}

function seed(): Store {
  const clientIdFor = (name: string) =>
    demoClients.find((c) => c.full_name === name)?.client_id ?? "d1";

  const clients: StoredClient[] = demoDashboard.map((row) => {
    const detail = demoClients.find((c) => c.client_id === row.client_id);
    return { ...row, status: detail?.status ?? "active", started_at: detail?.started_at ?? null };
  });

  const programs: StoredProgram[] = demoPrograms.map((p) => {
    const detail = p.id === demoProgramDetail.id ? demoProgramDetail : null;
    return {
      id: p.id,
      coach_id: DEMO_COACH_ID,
      client_id: clientIdFor(p.client_name),
      client_name: p.client_name,
      name: p.name,
      status: p.status,
      intensity_mode: detail?.intensity_mode ?? "rir",
      weeks: detail?.weeks ?? 4,
      updated_at: p.updated_at,
      days: (detail?.days ?? []).map((d, dayIndex) => ({
        id: d.id,
        week_index: 1,
        day_index: dayIndex,
        name: d.name,
        muscle_groups: d.muscle_groups ?? [],
        exercises: d.exercises.map((e, position) => ({
          id: e.id,
          exercise_id: e.exercise,
          exercise_name: e.exercise,
          position,
          target_sets: e.sets,
          target_reps: e.reps,
          target_weight_kg: parseFloat(e.weight) || null,
          target_rpe: parseFloat(e.rpe) || null,
          rest_seconds: parseInt(e.rest, 10) || null,
          notes: null,
        })),
      })),
    };
  });

  const plans: StoredPlan[] = demoNutritionPlans.map((n) => ({
    id: n.id,
    client_id: clientIdFor(n.client_name),
    client_name: n.client_name,
    name: n.name,
    status: n.status,
    kcal_target: n.kcal_target,
    protein_target_g: n.protein_target_g,
    carbs_target_g: n.carbs_target_g,
    fat_target_g: n.fat_target_g,
    meals: n.id === "n1" ? seedMealsForMaria() : [],
  }));

  return { clients, programs, plans };
}

// The plan from WIREFRAMES W6, so the builder opens on something real.
function seedMealsForMaria(): StoredMeal[] {
  return [
    {
      id: "pm1", slot: "breakfast", name: "Breakfast", position: 0,
      foods: [
        food("Oats", 60, { kcal: 389, protein: 16.9, carbs: 66.3, fat: 6.9 }),
        food("Whey isolate", 30, { kcal: 370, protein: 85, carbs: 4, fat: 1.5 }),
        food("Blueberries", 100, { kcal: 57, protein: 0.7, carbs: 14.5, fat: 0.3 }),
      ],
    },
    {
      id: "pm2", slot: "lunch", name: "Lunch", position: 1,
      foods: [
        food("Chicken breast, raw", 200, { kcal: 165, protein: 31, carbs: 0, fat: 3.6 }),
        food("Rice, cooked", 180, { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 }),
        food("Olive oil", 10, { kcal: 884, protein: 0, carbs: 0, fat: 100 }),
      ],
    },
    {
      id: "pm3", slot: "dinner", name: "Dinner", position: 2,
      foods: [
        food("Salmon", 150, { kcal: 208, protein: 20, carbs: 0, fat: 13 }),
        food("Potatoes", 250, { kcal: 77, protein: 2, carbs: 17, fat: 0.1 }),
      ],
    },
  ];
}

function food(
  name: string,
  grams: number,
  per100g: { kcal: number; protein: number; carbs: number; fat: number },
): StoredMealFood {
  return { id: newId("pmf"), food_name: name, grams, per_100g: per100g };
}
