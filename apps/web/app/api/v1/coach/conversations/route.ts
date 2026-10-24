import type { CoachConversationV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getConversations } from "@/lib/data";

// The coach's conversations, newest first — the web's /messages.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const rows = await getConversations();
  return apiJson<CoachConversationV1[]>(
    rows.map((c) => ({
      id: c.id,
      client_id: c.client_id,
      name: c.full_name,
      last_message: c.last_message,
      last_at: c.last_at,
      unread: c.unread,
      open: c.open,
    })),
  );
});
