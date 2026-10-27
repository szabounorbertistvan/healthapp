import type { CoachThreadV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getMyCoachThread } from "@/lib/client-today";

// The thread with the person's current coach — what /coach shows on the web.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const thread = await getMyCoachThread();
  if (!thread) return apiJson<CoachThreadV1>({ conversation_id: null });
  return apiJson<CoachThreadV1>({
    conversation_id: thread.id,
    coach_name: thread.coach_name,
    messages: thread.messages.map((m) => ({
      id: m.id, body: m.body, at: m.at, mine: m.mine, attachment: m.attachment?.kind ?? null, attachment_seconds: m.attachment?.seconds ?? null,
    })),
  });
});
