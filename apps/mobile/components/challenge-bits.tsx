import type { ChallengeCardV1 } from "@healthapp/api/v1";
import type { ColorTokens } from "@healthapp/ui-tokens";
import { View } from "react-native";
import type { Dictionary } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { parseDay } from "@/lib/week";

// What the challenge list and a challenge's page share (the web's
// components/challenges.tsx): the type icons, the status colours, the deadline
// line and the progress bar.

export const CLOCK = "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 7v5l3 2";
export const PEOPLE = "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2 20a7 7 0 0 1 14 0M17 11a3 3 0 0 0 0-6M18 20h4a6 6 0 0 0-3-5.2";

/** challenges.tsx TYPE_ICON: what the challenge counts. */
export const TYPE_ICON: Record<string, string> = {
  workouts: "M2 10v4M22 10v4M5 8v8M19 8v8M8 6v12M16 6v12M8 12h8",
  training_load: "M4 18a8 8 0 1 1 16 0M12 18l4-5",
  volume: "M4 19h16M7 19V9M12 19V5M17 19v-6",
  active_days: "M8 3v3M16 3v3M5 6h14v14H5zM4 10h16M9 15l2 2 4-4",
  exercise_sessions: "M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11",
  strength_gain: "M4 17l5-5 3 3 7-7M15 8h5v5",
  check_ins: "M9 4h6v3H9zM6 5h12v16H6zM9 13l2 2 4-4",
  nutrition_days: "M7 3v7a2 2 0 0 0 4 0V3M9 10v11M16 3c-1.5 2-2 4-2 7h4c0-3-.5-5-2-7zM16 10v11",
  habit_completions: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M8 12l3 3 5-6",
};

export function statusTone(status: ChallengeCardV1["status"], color: ColorTokens): { bg: string; ink: string } {
  return {
    active: { bg: color.accentSoft, ink: color.accentInk },
    upcoming: { bg: color.bg, ink: color.inkSoft },
    completed: { bg: color.accent, ink: color.accentFg },
    ended: { bg: color.bg, ink: color.inkFaint },
  }[status];
}

/** challenges.tsx deadlineText: what the deadline line says, from the card's status. */
export function deadlineText(
  c: Pick<ChallengeCardV1, "status" | "start_date" | "end_date" | "completed_at" | "days_remaining">,
  ch: Dictionary["common"]["challenges"],
  fill: (s: string, v: Record<string, string | number>) => string,
  date: (day: string) => string,
): string {
  if (c.status === "upcoming") {
    const days = Math.max(1, Math.round((parseDay(c.start_date).getTime() - Date.now()) / 86_400_000));
    return days === 1 ? ch.startsTomorrow : fill(ch.startsIn, { days });
  }
  if (c.status === "ended") return fill(ch.endedOn, { date: date(c.end_date) });
  if (c.status === "completed" && c.completed_at) return fill(ch.completedOn, { date: date(c.completed_at.slice(0, 10)) });
  return c.days_remaining === 1 ? ch.oneDayRemaining : fill(ch.daysRemaining, { days: c.days_remaining });
}

/** The bar every surface shares — gold once half way or complete. */
export function ChallengeBar({ pct, completed, height = 8 }: { pct: number; completed: boolean; height?: number }) {
  const { color } = useTheme();
  return (
    <View style={{ height, borderRadius: 999, overflow: "hidden", backgroundColor: color.bg }}>
      <View style={{ height: "100%", borderRadius: 999, width: `${Math.min(100, pct)}%`, backgroundColor: completed || pct >= 50 ? color.accent : color.inkSoft }} />
    </View>
  );
}
