/**
 * Onboarding: the welcome cards, the setup steps and the page tours — the
 * model only, free of React and of the network (packages/shared/src/onboarding.test.ts).
 *
 * State lives in `onboarding_state` (20261123100000): one flat map per person,
 * key → mark, written one key at a time through onboarding_mark(). The keys:
 *
 *   welcome      the welcome cards          done | skipped
 *   setup        the setup checklist        done | dismissed
 *   step:<id>    one setup step             done | skipped
 *   tour:<id>    one page's tour            done | dismissed
 *   tips         automatic tours, all       dismissed
 *
 * `null` state means "unknown" — the read failed or the migration has not
 * reached this project. Unknown never redirects anyone and never opens a tour
 * by itself: guidance that cannot remember being closed must not appear.
 */
import type { Role } from "./entitlements";

export const ONBOARDING_MARKS = ["done", "skipped", "dismissed"] as const;
export type OnboardingMark = (typeof ONBOARDING_MARKS)[number];
export type OnboardingState = Readonly<Record<string, OnboardingMark>>;

/** Same pattern as onboarding_mark() in SQL. */
export const ONBOARDING_KEY = /^(welcome|setup|tips|step:[a-z_]{1,32}|tour:[a-z_]{1,32})$/;

export function isOnboardingKey(key: unknown): key is string {
  return typeof key === "string" && ONBOARDING_KEY.test(key);
}
export function isOnboardingMark(mark: unknown): mark is OnboardingMark {
  return typeof mark === "string" && (ONBOARDING_MARKS as readonly string[]).includes(mark);
}

/** Whatever came back from the database or the device → a clean map; junk is dropped, never thrown. */
export function parseOnboardingState(raw: unknown): OnboardingState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, OnboardingMark> = {};
  for (const [key, mark] of Object.entries(raw)) {
    if (isOnboardingKey(key) && isOnboardingMark(mark)) out[key] = mark;
  }
  return out;
}

/** The server's map plus marks this device made that never reached it (a failed write). */
export function mergeStates(server: OnboardingState | null, local: OnboardingState): OnboardingState | null {
  if (server === null) return Object.keys(local).length > 0 ? { ...local } : null;
  return { ...local, ...server };
}

/** Keys the device holds that the server lacks or disagrees on — to send again. */
export function pendingSync(server: OnboardingState, local: OnboardingState): [string, OnboardingMark][] {
  return Object.entries(local).filter(([key, mark]) => server[key] !== mark);
}

// ---------- who sees which flow ----------

export type Audience = "client" | "coach";

/**
 * A coach (or a client who became one, `both`) gets the coach flow; a client
 * the client flow. Admins are staff: they are never sent anywhere, but the
 * flow still opens from the link — as the coach one, the shell they sit in.
 */
export function audienceOf(role: Role): Audience {
  return role === "client" ? "client" : "coach";
}

/** Whether /today or /dashboard should send this person to the welcome cards first. */
export function shouldStartOnboarding(state: OnboardingState | null, role: Role): boolean {
  if (state === null) return false; // unknown: never bounce anyone on a failed read
  if (role === "admin") return false;
  return state.welcome === undefined;
}

// ---------- setup steps ----------

export const CLIENT_STEPS = ["photo", "units", "goal", "training"] as const;
export const COACH_STEPS = ["photo", "public_profile", "invite", "program"] as const;
export type ClientStep = (typeof CLIENT_STEPS)[number];
export type CoachStep = (typeof COACH_STEPS)[number];
export type SetupStep = ClientStep | CoachStep;

export function stepsFor(audience: Audience): readonly SetupStep[] {
  return audience === "client" ? CLIENT_STEPS : COACH_STEPS;
}

/**
 * What the account already has, read from the data itself — a step whose fact
 * is true is done whatever the state says, so nobody is asked twice for
 * something they gave on another screen.
 */
export type SetupFacts = Partial<Record<SetupStep, boolean>>;

export type StepStatus = "done" | "skipped" | "todo";

export function stepStatus(step: SetupStep, facts: SetupFacts, state: OnboardingState): StepStatus {
  if (facts[step]) return "done";
  const mark = state[`step:${step}`];
  if (mark === "done") return "done";
  if (mark === "skipped") return "skipped";
  return "todo";
}

export type SetupProgress = {
  steps: { id: SetupStep; status: StepStatus }[];
  done: number;
  total: number;
  /** Index of the step to resume at: the first not yet answered, else the first skipped; -1 when all are done. */
  resumeAt: number;
  /** Nothing left to answer — every step done or skipped. */
  answered: boolean;
};

export function setupProgress(audience: Audience, facts: SetupFacts, state: OnboardingState): SetupProgress {
  const steps = stepsFor(audience).map((id) => ({ id, status: stepStatus(id, facts, state) }));
  const done = steps.filter((s) => s.status === "done").length;
  const todo = steps.findIndex((s) => s.status === "todo");
  const skipped = steps.findIndex((s) => s.status === "skipped");
  return {
    steps,
    done,
    total: steps.length,
    resumeAt: todo >= 0 ? todo : skipped,
    answered: todo < 0,
  };
}

/** `?step=goal` → its index in this audience's steps; anything else → null. */
export function parseStepParam(audience: Audience, raw: string | string[] | undefined | null): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const i = (stepsFor(audience) as readonly string[]).indexOf(value);
  return i >= 0 ? i : null;
}

/** The step the flow opens on: the one asked for, else where the person left off, else the first. */
export function openingStep(audience: Audience, progress: SetupProgress, asked: string | string[] | undefined | null): number {
  const explicit = parseStepParam(audience, asked);
  if (explicit !== null) return explicit;
  return progress.resumeAt >= 0 ? progress.resumeAt : 0;
}

/**
 * The "Continue setting up" card on Today / the dashboard: shown while some
 * step is still open (not done) and the person has neither finished nor hidden
 * the checklist. Skipped steps count as open — the card is how one comes back
 * to them — until the checklist itself is finished or hidden.
 */
export function showSetupCard(state: OnboardingState | null, progress: SetupProgress, role?: Role): boolean {
  if (state === null) return false;
  if (role === "admin") return false; // staff, not a coach setting up a practice
  if (state.welcome === undefined) return false; // the flow itself comes first
  if (state.setup === "done" || state.setup === "dismissed") return false;
  return progress.done < progress.total;
}

// ---------- page tours ----------

export const TOUR_IDS = [
  "today", "workout", "food", "progress", "account", "discovery",
  "dashboard", "clients", "programs", "nutrition", "settings",
] as const;
export type TourId = (typeof TOUR_IDS)[number];

export function tourKey(id: TourId): `tour:${TourId}` {
  return `tour:${id}`;
}

/**
 * Whether a page's tour opens by itself: once, for someone whose state is
 * known, who has not finished or closed it, has not switched tips off, and is
 * past the welcome cards. `deviceOff` is the device-wide switch (the E2E
 * suites set it so a tip never lands on a control a test clicks).
 */
export function shouldAutoOpenTour(state: OnboardingState | null, id: TourId, deviceOff = false): boolean {
  if (deviceOff || state === null) return false;
  if (state.tips === "dismissed") return false;
  if (state.welcome === undefined) return false;
  return state[tourKey(id)] === undefined;
}

/** Done when the last step was reached, dismissed when closed early. Either keeps it from coming back. */
export function tourEndMark(stepIndex: number, total: number): OnboardingMark {
  return stepIndex >= total - 1 ? "done" : "dismissed";
}

// ---------- the tour popover's placement ----------

export type Rect = { top: number; left: number; width: number; height: number };
export type Placement = { top: number; left: number; side: "below" | "above" };

/**
 * Where the popover goes for a target: below it when it fits, else above,
 * else whichever side has more room — never on top of the target itself, and
 * clear of `bottomInset` (the phone tab bar). Horizontally centred on the
 * target, clamped to the viewport's gutter. All in viewport coordinates.
 */
export function placePopover(
  target: Rect,
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
  { gap = 12, gutter = 16, bottomInset = 0 }: { gap?: number; gutter?: number; bottomInset?: number } = {},
): Placement {
  const usableBottom = viewport.height - bottomInset;
  const below = target.top + target.height + gap;
  const above = target.top - gap - popover.height;
  const fitsBelow = below + popover.height <= usableBottom - gutter;
  const fitsAbove = above >= gutter;
  let side: Placement["side"];
  if (fitsBelow) side = "below";
  else if (fitsAbove) side = "above";
  else side = usableBottom - (target.top + target.height) >= target.top ? "below" : "above";
  const rawTop = side === "below" ? below : above;
  const top = Math.max(gutter, Math.min(rawTop, usableBottom - gutter - popover.height));
  const maxLeft = Math.max(gutter, viewport.width - gutter - popover.width);
  const left = Math.max(gutter, Math.min(target.left + target.width / 2 - popover.width / 2, maxLeft));
  return { top: Math.round(top), left: Math.round(left), side };
}

// ---------- the recipes tip (DishFinder) ----------

/**
 * The card that shows where DishFinder's recipes are (under every meal on the
 * Nutrition page) and how to use them. Its mark rides on the tour namespace,
 * which onboarding_mark() already accepts — no migration:
 *   done       recipes were opened (from the card or from any meal's link),
 *              or the steps were read to the end
 *   dismissed  "Don't show again"
 * "Later" is not a mark: a marks map has no dates, so it is the cookie
 * RECIPES_LATER_COOKIE in lib/onboarding.ts, which simply expires after
 * RECIPES_LATER_DAYS — per device, like the solo choice.
 */
export const RECIPES_TIP_KEY = "tour:recipes";
export const RECIPES_LATER_DAYS = 7;

/**
 * Whether the recipes card shows: only where a deployment actually serves
 * recipes, only for someone whose state is known and who is past the welcome
 * cards, never for admins, never once opened / read / dismissed, and not while
 * "Later" holds on this device. Not muted by the tips switch: that one is
 * about tours opening by themselves; this card waits on the page.
 */
export function shouldShowRecipesTip(
  state: OnboardingState | null,
  role: Role,
  { enabled, later }: { enabled: boolean; later: boolean },
): boolean {
  if (!enabled || later || state === null) return false;
  if (role === "admin") return false;
  if (state.welcome === undefined) return false; // the welcome cards come first
  return state[RECIPES_TIP_KEY] === undefined;
}
