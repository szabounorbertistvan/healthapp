// Pure, so it is tested in node (push-route.test.ts): the push and the
// notifications list must open the same screen for the same category.

/** Where a tapped notification goes: the native screen for it, else the list. */
export function routeFor(data: Record<string, unknown> | undefined): "/messages" | "/check-in" | "/workout" | "/food" | "/notifications" {
  const category = typeof data?.category === "string" ? data.category : "";
  if (category === "new_message") return "/messages";
  if (category === "new_feedback" || category.startsWith("checkin")) return "/check-in";
  if (category === "plan_updated" || category === "workout_reminder") return "/workout";
  if (category === "nutrition_plan_updated") return "/food";
  return "/notifications";
}
