// Pure, so it is tested in node (push-route.test.ts): the push and the
// notifications list must open the same screen for the same category.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where a tapped notification goes: the native screen for it, else the list. */
export function routeFor(data: Record<string, unknown> | undefined): string {
  const category = typeof data?.category === "string" ? data.category : "";
  const conversation = typeof data?.conversation_id === "string" && UUID.test(data.conversation_id) ? data.conversation_id : null;
  // The exact thread when the row names it (either side); else the client's own coach thread.
  if (category === "new_message") return conversation ? `/thread/${conversation}` : "/messages";
  // What a coach has to act on.
  if (category === "checkin_submitted" || category.startsWith("coaching_request")) return "/inbox";
  if (category === "client_at_risk") return "/clients";
  // What a client gets.
  if (category === "new_feedback" || category.startsWith("checkin")) return "/check-in";
  if (category === "plan_updated" || category === "workout_reminder") return "/workout";
  if (category === "nutrition_plan_updated") return "/food";
  return "/notifications";
}
