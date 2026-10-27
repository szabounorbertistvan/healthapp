import type { ShareCardV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { APP_NAME } from "@/lib/brand";
import { getI18n } from "@/lib/i18n/server";
import { getPlan } from "@/lib/plan";
import {
  DEFAULT_SHARE_OPTIONS, SHARE_CARD_COLORS, SHARE_FORMATS, SHARE_STAT_KEYS, layoutShareCard, type ShareCardOptions, type ShareFormat, type ShareStatKey,
} from "@/lib/share-card";
import { getWorkoutShareCard } from "@/lib/share-card-data";
import { shareFileName } from "@/lib/share-card-render";

// The "Share Workout" card for the app — the web's ShareWorkoutDialog, laid
// out here by the web's own layoutShareCard() for one of the reader's own
// sessions (getWorkoutShareCard: every number is the server's). The app only
// paints the items. ?format=story|square&stats=duration,sets…&profile=0|1;
// the square format, the stat choice and hiding the profile need the plan's
// shareCustomize, otherwise the default card comes back.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const q = new URL(request.url).searchParams;
  const [card, { t, locale }, plan] = await Promise.all([getWorkoutShareCard(q.get("session") ?? ""), getI18n(), getPlan()]);
  if (!card) return apiError("not_found", 404);
  const customize = plan.e.shareCustomize;
  const format = (SHARE_FORMATS as readonly string[]).includes(q.get("format") ?? "") ? (q.get("format") as ShareFormat) : "story";
  const picked = q.get("stats");
  const options: ShareCardOptions = customize
    ? {
        format,
        stats: picked === null ? DEFAULT_SHARE_OPTIONS.stats
          : Object.fromEntries(SHARE_STAT_KEYS.map((k) => [k, picked.split(",").includes(k)])) as Record<ShareStatKey, boolean>,
        showProfile: q.get("profile") !== "0",
      }
    : DEFAULT_SHARE_OPTIONS;
  const s = t.common.shareCard;
  const layout = layoutShareCard({
    card, options, locale,
    labels: {
      workoutComplete: s.workoutComplete, duration: s.duration, exercises: s.exercises, sets: s.sets, volume: s.volume,
      volumeUnit: s.volumeUnit, trainingLoad: s.trainingLoad, loadCategory: t.common.trainingLoad.category,
      newPr: s.newPr, prsCount: s.prsCount, morePrs: s.morePrs, brand: APP_NAME,
    },
  });
  return apiJson<ShareCardV1>({
    layout, colors: SHARE_CARD_COLORS, options, customize, has_profile: Boolean(card.profile), avatar_url: card.profile?.avatar_url ?? null,
    photo_url: null, file_name: shareFileName(card.workout.date, options.format), title: card.workout.name,
  });
});
