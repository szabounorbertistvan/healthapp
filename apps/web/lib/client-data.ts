// Server-side data access for the client (trainee) surface.
//
// Same contract as lib/data.ts: everything goes through Supabase under RLS.
// Every number a client sees comes from @healthapp/shared, so the coach looking
// at the same week gets the identical figure rather than a second
// implementation.
//
// Split by domain so a food change does not mean scrolling past programs:
//   client-training   programs, days, sessions, PRs, load
//   client-nutrition  today's log, week strip, published plan
//   client-progress   habits, measurements, check-ins
//   client-today      the Today aggregate, empty-account, coach thread
import "server-only";

export { currentActorId as currentClientId } from "./actor";
export {
  LOGGED_SET_SELECT,
  toLoggedSetRow,
  type SetJoin,
  getMyProgramGroups,
  getMyProgramDays,
  getWorkoutDay,
  getWorkoutDayHistory,
  getMySessions,
  getMyTrainingLoad,
  getMyPrs,
} from "./client-training";
export { getMyDayNutrition, getMyFoodDays, getMyPlanMeals, getMyQuickFoods } from "./client-nutrition";
export { getMyHabits, getMyMeasurements, getMyCheckInState } from "./client-progress";
export { isEmptyAccount, getToday, getMyCoachThread, hasActiveCoach } from "./client-today";
