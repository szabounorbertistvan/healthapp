import "server-only";
import { LOCALE_HEADER, type ApiError } from "@healthapp/api/v1";
import { defaultLocale, isLocale } from "@/lib/i18n";
import { withBearer } from "@/lib/supabase/bearer";
import { currentUserId } from "@/lib/supabase/server";

/**
 * Every /api/v1 route handler is wrapped in this. It takes the Android app's
 * access token from `Authorization: Bearer …` and its language from
 * `x-voinic-locale`, then runs the handler inside lib/supabase/bearer.ts's
 * context — so the handler calls the same lib/ reads (and, later, the same
 * action cores) the web does, as the token's owner, under the same RLS.
 *
 * Fails closed: no token, or a token that does not verify, is a 401 before the
 * handler runs. middleware.ts lets /api/v1/ through its cookie gate for that
 * reason — this is the gate.
 */
export function v1Route(
  handler: (request: Request, ctx: { userId: string }) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const header = request.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!token) return apiError("unauthorized", 401);
    const lang = request.headers.get(LOCALE_HEADER);
    const locale = isLocale(lang) ? lang : defaultLocale;
    return withBearer({ token, locale }, async () => {
      const userId = await currentUserId();
      if (!userId) return apiError("unauthorized", 401);
      try {
        return await handler(request, { userId });
      } catch (error) {
        console.error(`[api/v1] ${new URL(request.url).pathname}:`, error);
        return apiError("server_error", 500);
      }
    });
  };
}

export function apiJson<T>(body: T, status = 200): Response {
  // One person's health data: never cached by anything between here and the phone.
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function apiError(error: ApiError["error"], status: number): Response {
  return apiJson<ApiError>({ error }, status);
}
