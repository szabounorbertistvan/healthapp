import type { WeeklySummaryV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getMyWeeklySummary } from "@/lib/weekly-data";

// The reader's weekly summary — Today's weekly report on the web: this week (or
// ?week=previous) against the one before, on their own calendar. Null when signed out.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const week = new URL(request.url).searchParams.get("week") === "previous" ? "previous" : "current";
  return apiJson<WeeklySummaryV1 | null>(await getMyWeeklySummary(week));
});
