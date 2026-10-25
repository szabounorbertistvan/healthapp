import type { GymDetailV1 } from "@healthapp/api/v1";
import { gymOpenState } from "@healthapp/shared";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import {
  GYM_RECORD_KINDS, GYM_RECORD_PERIODS, getGymCoaches, getGymRecordLifts, getGymRecords, getGymStats, getMyGyms,
  type GymRecordKind, type GymRecordPeriod,
} from "@/lib/gym-data";
import { gymMapHref, gymWhere } from "@/lib/gym-map";
import { getLocale } from "@/lib/i18n/server";

// One gym — the web's /gyms/[id]: ?lift= ?kind=e1rm|weight ?period=all|year|month
// pick the records board, as the page's URL does. Every activity number is
// null below three people (gym_stats), exactly as the page shows it.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = v1Route(async (request) => {
  const url = new URL(request.url);
  const id = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
  if (!UUID.test(id)) return apiError("not_found", 404);
  const q = url.searchParams;
  const kind: GymRecordKind = (GYM_RECORD_KINDS as readonly string[]).includes(q.get("kind") ?? "") ? (q.get("kind") as GymRecordKind) : "e1rm";
  const period: GymRecordPeriod = (GYM_RECORD_PERIODS as readonly string[]).includes(q.get("period") ?? "") ? (q.get("period") as GymRecordPeriod) : "all";
  const [stats, coaches, lifts, my, locale] = await Promise.all([getGymStats(id), getGymCoaches(id), getGymRecordLifts(id), getMyGyms(), getLocale()]);
  if (!stats) return apiError("not_found", 404);
  const wanted = q.get("lift");
  const lift = lifts.find((l) => l.exercise_id === wanted)?.exercise_id ?? lifts[0]?.exercise_id ?? null;
  const records = lift ? await getGymRecords(id, lift, kind, period) : [];

  // "Open now" on the gym's own clock (Romanian gyms: Bucharest time).
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date());
  const part = (k: string) => clock.find((x) => x.type === k)?.value ?? "";
  const dayIdx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday"));
  const g = stats.gym;

  return apiJson<GymDetailV1>({
    id: g.id,
    name: g.name,
    where: gymWhere(g.address, g.city),
    map_url: gymMapHref(g),
    rating: g.google_rating == null ? null : Number(g.google_rating),
    ratings_total: g.google_ratings_total,
    open_state: gymOpenState(g.opening_periods, dayIdx, Number(part("hour")), Number(part("minute"))),
    phone: g.phone,
    website: g.website,
    summary: g.summary,
    closed_for_good: Boolean(g.google_business_status && g.google_business_status !== "OPERATIONAL"),
    opening_hours: g.opening_hours ?? [],
    is_home: stats.is_home,
    on_boards: my.board,
    members: stats.members,
    coaches_count: stats.coaches,
    board: stats.board,
    week: stats.week,
    month: stats.month,
    my_month: stats.my_month,
    busy_hours: stats.busy_hours,
    busy_days: stats.busy_days,
    lifts: lifts.map((l) => ({ exercise_id: l.exercise_id, name: locale === "ro" ? l.name_ro || l.name_en : l.name_en, lifters: l.lifters })),
    lift,
    kind,
    period,
    records: records.map((r) => ({
      rank: r.rank, user_id: r.user_id, display_name: r.display_name, avatar_url: r.avatar_url,
      weight_kg: r.weight_kg, reps: r.reps, achieved_at: r.achieved_at, is_me: r.is_me,
    })),
    coaches: coaches.map((c) => ({ id: c.coach_profile_id, slug: c.slug, display_name: c.display_name, avatar_url: c.avatar_url, headline: c.headline })),
  });
});
