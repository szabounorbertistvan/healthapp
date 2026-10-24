import type { DashboardV1 } from "@healthapp/api/v1";
import { FITNESS_SCORE_MIN_WORKOUTS, localDay } from "@healthapp/shared";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { sessionCard } from "@/lib/api/workouts";
import { getMyChallenges } from "@/lib/challenges-data";
import { getMySessions, getToday } from "@/lib/client-data";
import { getMyFitnessScore } from "@/lib/fitness-score-data";
import { getI18n } from "@/lib/i18n/server";
import { getLeaderboard } from "@/lib/leaderboard-data";
import { myCalendar } from "@/lib/my-today";
import { getMyStreak } from "@/lib/streak-data";
import { todayNudge } from "@/lib/today-nudge";

// The app's Today, 1:1 with the web's /today: the same reads in the same wave
// (app/(client)/today/page.tsx), so the phone shows the same week score, the
// same next workout, the same streak and the same words for at risk.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [{ t, locale }, today, challenges, recent, streakView, board, fitness, calendar] = await Promise.all([
    getI18n(),
    getToday(),
    getMyChallenges().catch(() => []),
    getMySessions(3),
    getMyStreak(),
    getLeaderboard("training_load", "week").catch(() => null),
    getMyFitnessScore().catch(() => null),
    myCalendar(),
  ]);
  if (!today) return apiError("not_found", 404);

  const doneToday = recent.find((s) => localDay(s.at, calendar.timeZone) === calendar.today) ?? null;
  const next = today.next_workout;
  const a = today.adherence;
  return apiJson<DashboardV1>({
    today: calendar.today,
    time_zone: calendar.timeZone,
    has_coach: today.has_coach,
    adherence: { overall: a.overall, workout: a.workout, nutrition: a.nutrition, habits: a.habits, checkin: a.checkin, signal: a.signal },
    sessions: { done: today.sessions_done, planned: today.sessions_planned },
    streak_days: today.streak_days,
    nudge: todayNudge(today, t.clientApp.today, locale),
    workout_days: today.training_load.daily.filter((x) => x.load > 0).map((x) => x.day),
    load: {
      this_week: today.training_load.this_week,
      delta_pct: today.training_load.trend.delta_pct,
      direction: today.training_load.trend.direction,
    },
    fitness: fitness
      ? {
          status: fitness.current.status === "building" ? "building" : "active",
          score: fitness.current.score,
          band: fitness.current.band,
          completed_workouts: fitness.current.completedWorkouts,
          min_workouts: FITNESS_SCORE_MIN_WORKOUTS,
        }
      : null,
    next: next
      ? {
          day_id: next.day_id,
          day_name: next.day_name,
          program_name: next.program_name,
          is_own: next.is_own,
          completed: next.completed,
          logged: next.logged.length,
          total_sets: next.exercises.reduce((sum, e) => sum + e.sets, 0),
          exercises: next.exercises.map((e) => ({
            id: e.id,
            name: e.exercise,
            sets: e.sets,
            reps: e.reps,
            weight: e.weight,
            measure: e.measure === "time" ? "time" : "reps",
          })),
        }
      : null,
    done_today: doneToday ? sessionCard(doneToday) : null,
    recent: recent.map(sessionCard),
    streak: streakView
      ? {
          current: streakView.summary.current,
          longest: streakView.summary.longest,
          active_today: streakView.summary.activeToday,
          active_yesterday: streakView.summary.activeYesterday,
        }
      : null,
    nutrition: {
      plan_name: today.nutrition.plan_name,
      plan_owner: today.nutrition.plan_owner,
      target: today.nutrition.target,
      totals: today.nutrition.totals,
      entries: today.nutrition.entries.map((e) => ({ slot: e.slot, food_name: e.food_name, kcal: e.macros.kcal })),
    },
    habits: today.habits.map((h) => ({ id: h.id, name: h.name, done_today: h.done_today })),
    check_in: { submitted: today.check_in.submitted, coach_feedback: today.check_in.last?.coach_feedback ?? null },
    unread_from_coach: today.unread_from_coach,
    community: {
      leaderboard_rank: board?.me?.rank ?? null,
      active_challenges: challenges.filter((c) => c.joined && c.status === "active").length,
    },
  });
});
