import type { LeaderboardV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getMyGyms } from "@/lib/gym-data";
import { getLeaderboard, metricOf, periodOf, scopeOf } from "@/lib/leaderboard-data";

// One leaderboard for the app — /leaderboards' own read (one RPC: top 10 plus the viewer).
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const q = new URL(request.url).searchParams;
  const metric = metricOf(q.get("metric") ?? undefined);
  const period = periodOf(q.get("period") ?? undefined);
  const scope = scopeOf(q.get("scope") ?? undefined);
  const [board, gyms] = await Promise.all([getLeaderboard(metric, period, scope), scope === "gym" ? getMyGyms() : null]);
  return apiJson<LeaderboardV1>({
    metric,
    period,
    scope,
    board,
    gym: gyms ? { home: gyms.home !== null, board: gyms.board } : null,
  });
});
