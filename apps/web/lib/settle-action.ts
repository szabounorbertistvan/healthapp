/**
 * A server action called from the browser normally resolves to its
 * `ActionResult`. When the request never gets an answer — the connection
 * drops, the server restarts mid-deploy, a proxy times out — the call REJECTS
 * instead. Awaited inside `startTransition` with nothing to catch it, that
 * rejection reaches the error boundary and the whole screen is replaced by
 * "Something went wrong on this screen", taking the coach's open editor with
 * it (found by e2e-local/programs.spec.ts, 2026-10-13).
 *
 * `settle()` turns that into the failed result the screen already knows how
 * to show. Next's own control flow — `redirect()` / `notFound()` from an
 * action, thrown as errors carrying a NEXT_ digest — is rethrown untouched.
 */
export type Settled = { ok: boolean; message?: string };

/** The failed result settle() answers with; `errorCode` is declared (and absent) so callers that read it still type-check. */
export type Unanswered = { ok: false; message: string; errorCode?: undefined };

export async function settle<T extends Settled>(call: () => Promise<T>, unreachable: string): Promise<T | Unanswered> {
  try {
    return await call();
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    console.error("server action did not answer:", error);
    return { ok: false, message: unreachable };
  }
}

function isNextControlFlow(error: unknown): boolean {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest: unknown }).digest) : "";
  return /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)/.test(digest);
}

/**
 * The same for a server action that reads — a search, a barcode lookup, a page
 * of results — whose answer is not an ActionResult. A call that never answered
 * gives `null`: the caller keeps what is on screen, resets its own loading
 * state and says so, instead of the error boundary taking the screen.
 */
export async function settleRead<T>(call: () => Promise<T>): Promise<T | null> {
  try {
    return await call();
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    console.error("server action did not answer:", error);
    return null;
  }
}
