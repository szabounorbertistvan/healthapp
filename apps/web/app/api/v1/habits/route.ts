import type { HabitsV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getMyHabits } from "@/lib/client-data";
import { myToday } from "@/lib/my-today";

// The person's habits with today's tick and the week's count — what /habits shows.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [habits, today] = await Promise.all([getMyHabits(), myToday()]);
  return apiJson<HabitsV1>({
    today,
    habits: habits.map((h) => ({
      id: h.id, name: h.name, target_per_week: h.target_per_week, done_today: h.done_today, done_this_week: h.done_this_week,
    })),
  });
});
