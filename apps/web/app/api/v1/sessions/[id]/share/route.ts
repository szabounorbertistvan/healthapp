import type { CodedResultV1 } from "@healthapp/api/v1";
import type { PostMediaInput } from "@healthapp/shared";
import { apiJson, v1Route } from "@/lib/api/v1";
import { setSessionGym } from "@/app/gym-actions";
import { sharePr, shareWorkout } from "@/app/social-actions";

// The writes of "Workout completed!" — the web's own actions: workout (the
// session to the feed, with words and pictures), pr (one PR set), gym (where
// it happened, or null to clear). Every number is the server's.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const id = decodeURIComponent(new URL(request.url).pathname.split("/").at(-2) ?? "");
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const visibility = typeof b?.visibility === "string" ? b.visibility : undefined;
  if (b?.op === "workout") {
    const r = await shareWorkout(id, visibility, typeof b.text === "string" ? b.text : undefined, Array.isArray(b.media) ? (b.media as PostMediaInput[]) : null);
    return apiJson<CodedResultV1>({ ok: r.ok, message: r.message });
  }
  if (b?.op === "pr") {
    const r = await sharePr(id, typeof b.setId === "string" ? b.setId : "", visibility);
    return apiJson<CodedResultV1>({ ok: r.ok, message: r.message });
  }
  if (b?.op === "gym") {
    const r = await setSessionGym(id, typeof b.gymId === "string" ? b.gymId : null);
    return apiJson<CodedResultV1>({ ok: r.ok, errorCode: r.error });
  }
  return apiJson<CodedResultV1>({ ok: false, errorCode: "INVALID_INPUT" }, 400);
});
