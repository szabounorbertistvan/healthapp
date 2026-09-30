// Where to continue after an auth step, taken from a `?next=` the query string
// carries. Only a path on this site ever comes out.
//
// A prefix check ("starts with / but not //") is not enough: the WHATWG URL
// parser — the one NextResponse.redirect uses — reads "/\evil.com" and
// "/<TAB>/evil.com" as protocol-relative too, and both resolve to
// https://evil.com/. So the candidate is resolved against a throwaway origin
// and accepted only if it stays on that origin; what is returned is the
// resolved path, never the raw input.

const PROBE = "https://probe.invalid";

export function safeNext(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw || !raw.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  let url: URL;
  try {
    url = new URL(raw, PROBE);
  } catch {
    return fallback;
  }
  if (url.origin !== PROBE) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
