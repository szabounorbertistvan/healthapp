import type { MyCoachingRequestV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getMyCoachingRequests } from "@/lib/coach-profile-data";

// The coaches the reader contacted — the web's /coaches/requests, pending
// first (my_coaching_requests()). Cancelling is /coaches/act cancelRequest;
// messaging an accepted request is /coach/requests/act message.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => apiJson<MyCoachingRequestV1[]>(await getMyCoachingRequests()));
