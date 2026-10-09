import { safeNext } from "./safe-next";

/**
 * The user-metadata key the sign-up form writes its `next` into. The emailed
 * confirmation link cannot carry it: our template (supabase/templates/
 * confirmation.html) links straight to /auth/callback with a token_hash and has
 * no safe way to splice in the `next` the form sent — `{{ .RedirectTo }}` is
 * the whole callback URL with its own query string, and nesting it in another
 * query string breaks on a `next` that has an `&`. The metadata does travel:
 * it is stored with the account and handed back by verifyOtp(), so the
 * destination survives opening the email on another device. It is read on
 * `signup`/`email` links only, and like any `next` it goes through safeNext().
 */
export const SIGNUP_NEXT_KEY = "signup_next";

/** The link types whose landing may fall back to the sign-up's own `next`. */
const CONFIRMATION_TYPES = new Set(["signup", "email"]);

/**
 * Where /auth/callback sends someone once their emailed link has signed them
 * in. An explicit `?next=` wins (recovery links, PKCE `?code=` links, whose
 * URL is the `emailRedirectTo` the form built). Without one, a confirmation
 * link uses the `next` saved at sign-up; anything else lands on the default.
 */
export function callbackDestination(args: {
  next: string | null | undefined;
  type: string | null | undefined;
  metadata?: Record<string, unknown> | null;
}): string {
  if (args.next) return safeNext(args.next);
  const saved = args.metadata?.[SIGNUP_NEXT_KEY];
  if (args.type && CONFIRMATION_TYPES.has(args.type) && typeof saved === "string") return safeNext(saved);
  return safeNext(null);
}
