// The rest timer between sets — the rules the set logger, the timer bar and
// the settings screen share. Pure, so they are tested here and behave the
// same on every surface.
//
// The one rule that matters: a timer is two instants, `startedAt` and
// `endsAt`, and what is left is `endsAt - now`. No tick is ever counted. A
// phone that locks for forty seconds and comes back shows the right number
// because the number was never *accumulated*, only *derived* — which is also
// why every field is epoch milliseconds and nothing here knows a time zone.

export const DEFAULT_REST_SECONDS = 60;
export const REST_PRESETS = [30, 45, 60, 90, 120, 180] as const;
export const REST_EXTEND_SECONDS = 15;
/** Same ceiling as program_exercises.rest_seconds; the floor stops a "0 s" timer that ends before it shows. */
export const REST_MIN_SECONDS = 5;
export const REST_MAX_SECONDS = 600;

// ---------- settings ----------

/** users.rest_prefs — the person's own rest configuration. */
export type RestPrefs = {
  default_seconds: number;
  /** Rest-finished notifications wanted (browser permission is a separate question). */
  notify: boolean;
  /** exercises.id → seconds. Only the lifts the person chose to configure. */
  exercises: Record<string, number>;
};

function clampSeconds(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(REST_MAX_SECONDS, Math.max(REST_MIN_SECONDS, Math.round(value)));
}

/** The jsonb column as stored is untyped; this is the one place it is read. */
export function normalizeRestPrefs(raw: unknown): RestPrefs {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const exercises: Record<string, number> = {};
  const rawExercises = obj.exercises && typeof obj.exercises === "object" ? (obj.exercises as Record<string, unknown>) : {};
  for (const [id, value] of Object.entries(rawExercises)) {
    const seconds = clampSeconds(value);
    if (seconds !== null) exercises[id] = seconds;
  }
  return {
    default_seconds: clampSeconds(obj.default_seconds) ?? DEFAULT_REST_SECONDS,
    notify: obj.notify !== false,
    exercises,
  };
}

/**
 * How long to rest after a set of this exercise: the person's own override
 * for the lift, else what the coach prescribed on the program row, else the
 * person's default. A prescribed 0 is "nothing prescribed", not a zero timer.
 */
export function resolveRestSeconds(input: {
  exerciseId: string | null;
  prescribedSeconds: number | null;
  prefs: RestPrefs;
}): number {
  const override = input.exerciseId ? input.prefs.exercises[input.exerciseId] : undefined;
  if (override) return override;
  if (input.prescribedSeconds && input.prescribedSeconds > 0) {
    return Math.min(REST_MAX_SECONDS, Math.max(REST_MIN_SECONDS, Math.round(input.prescribedSeconds)));
  }
  return input.prefs.default_seconds;
}

// ---------- the timer ----------

export type RestTimerStatus = "idle" | "running" | "paused" | "completed" | "skipped";

export type RestTimerNext = {
  programExerciseId: string;
  exerciseName: string;
  setIndex: number;
};

export type RestTimer = {
  /** Unique per rest period — the key every "only once" rule hangs on. */
  id: string;
  status: RestTimerStatus;
  /** Epoch ms. */
  startedAt: number;
  /** Epoch ms; moves on +15 s and on resume. */
  endsAt: number;
  durationSeconds: number;
  /** What was left when paused; null while running. */
  pausedRemainingMs: number | null;
  /** When the completion was surfaced, so it is surfaced once. */
  notifiedAt: number | null;
  context: {
    dayId: string;
    /** The set just logged. */
    exerciseName: string;
    setIndex: number;
    /** The set to do after the rest, when the plan knows it. */
    next: RestTimerNext | null;
  };
};

export function startRest(input: {
  id: string;
  durationSeconds: number;
  now: number;
  dayId: string;
  exerciseName: string;
  setIndex: number;
  next: RestTimerNext | null;
}): RestTimer {
  return {
    id: input.id,
    status: "running",
    startedAt: input.now,
    endsAt: input.now + input.durationSeconds * 1000,
    durationSeconds: input.durationSeconds,
    pausedRemainingMs: null,
    notifiedAt: null,
    context: {
      dayId: input.dayId,
      exerciseName: input.exerciseName,
      setIndex: input.setIndex,
      next: input.next,
    },
  };
}

/** What is left, derived from the end instant — never below zero. */
export function remainingMs(timer: RestTimer, now: number): number {
  if (timer.status === "paused") return Math.max(0, timer.pausedRemainingMs ?? 0);
  if (timer.status !== "running") return 0;
  return Math.max(0, timer.endsAt - now);
}

export function isRestActive(timer: RestTimer | null | undefined): boolean {
  return timer?.status === "running" || timer?.status === "paused";
}

/** A running timer whose end has passed is completed. Anything else is returned as-is. */
export function settleRest(timer: RestTimer, now: number): RestTimer {
  if (timer.status === "running" && now >= timer.endsAt) return { ...timer, status: "completed" };
  return timer;
}

export function pauseRest(timer: RestTimer, now: number): RestTimer {
  if (timer.status !== "running") return timer;
  return { ...timer, status: "paused", pausedRemainingMs: remainingMs(timer, now) };
}

export function resumeRest(timer: RestTimer, now: number): RestTimer {
  if (timer.status !== "paused") return timer;
  return {
    ...timer,
    status: "running",
    endsAt: now + (timer.pausedRemainingMs ?? 0),
    pausedRemainingMs: null,
  };
}

/**
 * +15 s. While paused it lengthens the frozen remainder; on a timer that has
 * already run out it starts the extra seconds from now, as a fresh end that
 * may announce itself once more.
 */
export function extendRest(timer: RestTimer, now: number, seconds = REST_EXTEND_SECONDS): RestTimer {
  const extra = seconds * 1000;
  if (timer.status === "paused") {
    return { ...timer, pausedRemainingMs: (timer.pausedRemainingMs ?? 0) + extra };
  }
  if (timer.status === "running") return { ...timer, endsAt: timer.endsAt + extra };
  if (timer.status === "completed") {
    return { ...timer, status: "running", endsAt: now + extra, notifiedAt: null };
  }
  return timer;
}

export function skipRest(timer: RestTimer): RestTimer {
  if (timer.status === "completed" || timer.status === "skipped") return timer;
  return { ...timer, status: "skipped", pausedRemainingMs: null };
}

/**
 * Whether to announce the completion now. True exactly once per timer id:
 * the timer must be completed and not yet announced.
 */
export function markRestNotified(timer: RestTimer, now: number): { timer: RestTimer; shouldNotify: boolean } {
  if (timer.status !== "completed" || timer.notifiedAt !== null) return { timer, shouldNotify: false };
  return { timer: { ...timer, notifiedAt: now }, shouldNotify: true };
}

/** "01:24" — whole seconds, rounded up so the display never shows 00:00 while time is left. */
export function formatRestClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// ---------- which set comes next ----------

export type PlannedSet = {
  programExerciseId: string;
  exerciseName: string;
  setIndex: number;
  circuit: number | null;
  /** Inside a circuit, which pass through its members this set belongs to (= setIndex). */
  round: number;
};

type PlannableExercise = {
  id: string;
  exercise: string;
  sets: number;
  position: number;
  circuit: number | null;
};

/**
 * The day's sets in the order they are meant to be performed: a standalone
 * exercise's sets back to back; a circuit as one set of each member per
 * round, rounds repeating until the longest member is done. Mirrors
 * circuitSegments() — position order is the truth, a circuit is a bracket
 * around neighbours in it.
 */
export function plannedSets(exercises: readonly PlannableExercise[]): PlannedSet[] {
  const sorted = [...exercises].sort((a, b) => a.position - b.position);
  const out: PlannedSet[] = [];
  const seenCircuit = new Set<number>();
  for (const e of sorted) {
    if (e.circuit === null) {
      for (let s = 1; s <= e.sets; s++) {
        out.push({ programExerciseId: e.id, exerciseName: e.exercise, setIndex: s, circuit: null, round: s });
      }
      continue;
    }
    if (seenCircuit.has(e.circuit)) continue;
    seenCircuit.add(e.circuit);
    const members = sorted.filter((m) => m.circuit === e.circuit);
    const rounds = Math.max(0, ...members.map((m) => m.sets));
    for (let r = 1; r <= rounds; r++) {
      for (const m of members) {
        if (m.sets >= r) {
          out.push({ programExerciseId: m.id, exerciseName: m.exercise, setIndex: r, circuit: m.circuit, round: r });
        }
      }
    }
  }
  return out;
}

/**
 * The first set still to do after the one just logged — searching forward
 * from it, then wrapping to anything skipped earlier. Null when the plan is
 * complete: that was the final set and no rest follows.
 */
export function nextPlannedSet(
  exercises: readonly PlannableExercise[],
  loggedCount: Readonly<Record<string, number>>,
  justLogged: { programExerciseId: string; setIndex: number },
): PlannedSet | null {
  const plan = plannedSets(exercises);
  const remaining = (s: PlannedSet) => (loggedCount[s.programExerciseId] ?? 0) < s.setIndex;
  const at = plan.findIndex(
    (s) => s.programExerciseId === justLogged.programExerciseId && s.setIndex === justLogged.setIndex,
  );
  const after = at >= 0 ? plan.slice(at + 1) : [];
  const before = at >= 0 ? plan.slice(0, at) : plan;
  return after.find(remaining) ?? before.find(remaining) ?? null;
}

/**
 * Whether a rest sits between two consecutive planned sets. Inside one round
 * of a circuit the members follow each other straight away — that is what a
 * superset is; the rest comes after the round's last member.
 */
export function restBetween(done: PlannedSet, next: PlannedSet | null): boolean {
  if (!next) return false;
  if (done.circuit !== null && done.circuit === next.circuit && done.round === next.round) return false;
  return true;
}

// ---------- the decision the set logger makes ----------

export type RestPlan = { durationSeconds: number; next: RestTimerNext };

/**
 * After "Log set" returns: whether to start a rest, for how long, and towards
 * what. Null means no timer — the save failed, the workout is already done,
 * this was the final set, or the next set is the paired exercise of a
 * superset round.
 */
export function restAfterLoggedSet(input: {
  saved: boolean;
  day: { exercises: readonly PlannableExercise[]; completed: boolean };
  loggedCount: Readonly<Record<string, number>>;
  justLogged: {
    programExerciseId: string;
    /** exercises.id, for the person's per-lift override. */
    exerciseId: string | null;
    setIndex: number;
    prescribedSeconds: number | null;
    /**
     * What the person typed in the REST box next to kg / reps for this very
     * set. Wins over every stored setting; null or NaN means "nothing typed".
     */
    restSecondsForThisSet?: number | null;
  };
  prefs: RestPrefs;
}): RestPlan | null {
  if (!input.saved || input.day.completed) return null;
  const next = nextPlannedSet(input.day.exercises, input.loggedCount, input.justLogged);
  if (!next) return null;
  const done = plannedSets(input.day.exercises).find(
    (s) => s.programExerciseId === input.justLogged.programExerciseId && s.setIndex === input.justLogged.setIndex,
  );
  if (done && !restBetween(done, next)) return null;
  const typed = clampSeconds(input.justLogged.restSecondsForThisSet);
  return {
    durationSeconds: typed ?? resolveRestSeconds({
      exerciseId: input.justLogged.exerciseId,
      prescribedSeconds: input.justLogged.prescribedSeconds,
      prefs: input.prefs,
    }),
    next: { programExerciseId: next.programExerciseId, exerciseName: next.exerciseName, setIndex: next.setIndex },
  };
}
