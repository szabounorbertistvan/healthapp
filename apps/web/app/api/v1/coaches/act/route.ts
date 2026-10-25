import type { CodedResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { bookService } from "@/app/booking-actions";
import { cancelCoachingRequest, requestCoaching, toggleCoachSave } from "@/app/coach-profile-actions";
import { deleteMyReview, submitReview } from "@/app/review-actions";

// What a reader does on a coach's page — the web's own actions, named by `op`:
// request (contact the coach), cancelRequest, save (the private shortlist),
// book (one start of one service), review / deleteReview. The database decides
// every one of them (request_coaching, book_service, submit_coach_review…).
export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const opt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  let r: { ok: boolean; message?: string; errorCode?: string; id?: string };
  switch (b?.op) {
    case "request": {
      const format = b.format === "online" || b.format === "in_person" || b.format === "hybrid" ? b.format : null;
      const res = await requestCoaching({ profileId: str(b.profileId), serviceId: opt(b.serviceId), message: str(b.message), goal: opt(b.goal), format, slug: str(b.slug) });
      r = { ...res, id: res.requestId };
      break;
    }
    case "cancelRequest":
      r = await cancelCoachingRequest({ requestId: str(b.requestId), slug: str(b.slug) });
      break;
    case "save":
      r = await toggleCoachSave(str(b.profileId), b.saved === true);
      break;
    case "book": {
      const res = await bookService({ serviceId: str(b.serviceId), startAt: str(b.startAt), note: opt(b.note) });
      r = { ...res, id: res.bookingId };
      break;
    }
    case "review":
      r = await submitReview({ profileId: str(b.profileId), slug: str(b.slug), rating: typeof b.rating === "number" ? b.rating : NaN, body: opt(b.body) });
      break;
    case "deleteReview":
      r = await deleteMyReview(str(b.reviewId), str(b.slug));
      break;
    default:
      return apiJson<CodedResultV1>({ ok: false, errorCode: "INVALID_INPUT" }, 400);
  }
  return apiJson<CodedResultV1 & { id?: string }>({ ok: r.ok, message: r.message, errorCode: r.errorCode, id: r.id });
});
