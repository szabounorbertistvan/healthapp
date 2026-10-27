import type { FeedbackWriteV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { sendFeedback, type FeedbackKind } from "@/app/feedback-actions";

// "Send feedback" from the app — the web's FeedbackButton: submit_feedback()
// through the same action (capped 10/hour), read only on /admin/feedback. The
// route is the app screen the person was on.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const r = await sendFeedback(
    (typeof b?.kind === "string" ? b.kind : "") as FeedbackKind,
    typeof b?.message === "string" ? b.message : "",
    typeof b?.route === "string" ? `app:${b.route}` : "app",
  );
  return apiJson<FeedbackWriteV1>({ ok: r.ok, reason: r.reason });
});
