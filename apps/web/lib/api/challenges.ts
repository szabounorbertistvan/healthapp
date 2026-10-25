import "server-only";
import type { ChallengeCardV1 } from "@healthapp/api/v1";
import type { Dictionary } from "@/lib/i18n";
import { challengeSubtitle } from "@/lib/challenge-map";
import type { ChallengeCard } from "@/lib/types";

// A challenge card on the /api/v1 contract — the list and the detail share it,
// so the two can never word or count a challenge differently.
export function challengeCard(c: ChallengeCard, ch: Dictionary["common"]["challenges"]): ChallengeCardV1 {
  return {
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
  };
}
