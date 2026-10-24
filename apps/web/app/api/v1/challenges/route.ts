import type { ChallengesV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { challengeSubtitle } from "@/lib/challenge-map";
import { getMyChallenges } from "@/lib/challenges-data";
import { getI18n } from "@/lib/i18n/server";

// The app's challenges: /challenges' own read (challenge_cards — progress computed in SQL).
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [{ t }, cards] = await Promise.all([getI18n(), getMyChallenges()]);
  const ch = t.common.challenges;
  return apiJson<ChallengesV1>({
    cards: cards.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      type: c.type,
      subtitle: challengeSubtitle(c, ch),
      unit_label: ch.unit[c.type],
      target: c.target,
      start_date: c.start_date,
      end_date: c.end_date,
      participants: c.participants,
      joined: c.joined,
      can_join: c.can_join,
      completed_at: c.completed_at,
      progress: c.progress,
      pct: c.pct,
      status: c.status,
      days_remaining: c.days_remaining,
      is_platform: c.is_platform,
    })),
  });
});
