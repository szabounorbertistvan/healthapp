import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/safe-next";
import { userIdFromClient } from "@/lib/supabase/claims";
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/lib/i18n/config";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Trimmed for the same reason as lib/supabase/client.ts: these become header
// values, which may only hold ISO-8859-1, and a BOM pasted into the deployment
// environment would make every call from here fail.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

export async function middleware(request: NextRequest) {
  // No Supabase configured is a deployment fault, not a mode. Letting requests
  // through here would hand every gated route to anyone; the pages themselves
  // throw a named error from lib/supabase/server.ts, so failing closed is both
  // safe and diagnosable. Static assets never reach this matcher.
  if (!url || !anonKey) {
    return new NextResponse("Supabase is not configured.", { status: 500 });
  }

  // ?lang=ro|en from a shared link (DishFinder's promo sends its own language):
  // the request cookie makes this render use it, the response cookie keeps it.
  const urlLang = request.nextUrl.searchParams.get("lang");
  const langFromUrl = isLocale(urlLang) ? urlLang : null;
  if (langFromUrl) request.cookies.set(LOCALE_COOKIE, langFromUrl);

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Verify the token locally rather than asking the Auth server: this runs on
  // every request, including every client-side navigation, and a round trip
  // here sat in front of every page. See lib/supabase/claims.ts — including
  // why the fallback matters. An expiring session is still refreshed first,
  // and the cookie-copying below is what carries those refreshed tokens onto
  // a redirect, exactly as before.
  const signedIn = (await userIdFromClient(supabase, (error) => {
    console.error("[middleware] getClaims failed, falling back to getUser:", error);
  })) !== null;
  const path = request.nextUrl.pathname;
  if (langFromUrl) {
    response.cookies.set(LOCALE_COOKIE, langFromUrl, { path: "/", maxAge: LOCALE_COOKIE_MAX_AGE, sameSite: "lax" });
  }

  // The check above may have refreshed an expired session, and the refreshed
  // tokens live on `response`. A redirect is a different response object, so
  // without copying them the browser keeps its old refresh token, the next
  // request cannot refresh again, and a signed-in person bounces to the
  // landing page as if logged out — with /login itself unreachable, because
  // this middleware kept seeing the (refreshable) session and redirecting.
  const redirect = (to: string) => {
    const target = NextResponse.redirect(new URL(to, request.url));
    response.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
    return target;
  };
  // legal pages are public for everyone, signed in or not — no redirects either way.
  // Same for the auth callback and password reset: an already-signed-in user
  // clicking a recovery link must still reach them, or the token is lost.
  if (
    path.startsWith("/privacy") || path.startsWith("/terms") ||
    // Google Play requires the account-deletion explainer to open signed out
    path === "/delete-account" ||
    path.startsWith("/auth/") || path.startsWith("/reset-password") ||
    // precached by the service worker, and shown to whoever is offline
    path === "/offline" ||
    // Coach Discovery: a published coach page is public by design (search
    // engines too). The data behind it comes only from anon-granted RPCs that
    // refuse anything unpublished — the page needs no session.
    path === "/coaches" || path.startsWith("/coaches/") ||
    // what crawlers read first (20261107100000): a redirect to /login here
    // would hide the whole public directory from search engines
    path === "/robots.txt" || path === "/sitemap.xml" ||
    // TikTok's URL-property proof for the voinic-social poster app: a static
    // file in public/ that TikTok fetches signed out
    /^\/tiktok[A-Za-z0-9]+\.txt$/.test(path) ||
    // the link at the foot of every marketplace email (20261115100000): it
    // must work from any inbox, signed in or not — the token is the proof
    path === "/unsubscribe" || path === "/unsubscribe/one-click" ||
    // DishFinder's "Add to Voinic" form post (20261201100000): the person may
    // be signed out, and a redirect would drop the body. The route writes
    // nothing — it verifies the signature, parks the recipe in a cookie and
    // sends the person to /recipes, which is behind sign-in as usual.
    path === "/recipes/receive" ||
    // the workout-import templates (public/import/): two blank CSV headers,
    // nobody's data — the Android app opens them in the phone's browser,
    // which has no session, so the login redirect would hide them
    path === "/import/voinic-template.csv" || path === "/import/voinic-sablon.csv" ||
    // the calendar sync worker, called by a scheduler with a bearer secret
    // (app/api/cron/calendar-sync/route.ts checks it); there is no session
    path === "/api/cron/calendar-sync" ||
    // the Android app's API: no cookies, a bearer token instead — every
    // handler is wrapped in v1Route (lib/api/v1.ts), which refuses without one;
    // the one exception is /api/v1/app-config (version minimums, nobody's data)
    path.startsWith("/api/v1/") ||
    // a post picture asked for by the Android app: no cookies there either, so
    // it sends its access token. Let only such a request past the cookie gate —
    // app/api/media/[token]/route.ts verifies that token itself and refuses a
    // bad one; a request without it still needs a session here, as before.
    (path.startsWith("/api/media/") && hasBearer(request))
  ) return response;
  const isLanding = path === "/";
  const isLogin = path.startsWith("/login");

  // logged-out users see only the landing page (and login). A deep link — a
  // shared workout, a notification opened from an email — goes to the login
  // with the way back attached, instead of dropping the person on the landing.
  if (!signedIn && !isLanding && !isLogin) {
    const back = `${path}${request.nextUrl.search}`;
    return redirect(`/login?${new URLSearchParams({ next: back })}`);
  }
  // logged-in users skip the login page. The landing page stays reachable
  // (the logo links to it); it shows an "open the app" button instead of sign-in.
  if (signedIn && isLogin) {
    return redirect(safeNext(request.nextUrl.searchParams.get("next")));
  }
  return response;
}

/** `Authorization: Bearer <something>` — whether it verifies is the route's job. */
function hasBearer(request: NextRequest): boolean {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") && header.slice("Bearer ".length).trim().length > 0;
}

export const config = {
  // The worker (/serwist/sw.js) and the manifest are fetched by the browser
  // itself, session or no session (a worker update check runs in the
  // background); a redirect in place of the script would kill the registration.
  // /.well-known/ (assetlinks.json, the Android app's Digital Asset Links) is
  // read by Google's verifier without cookies: a redirect to /login there
  // would unlink the Play app from the site and show it a browser bar.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|serwist/|\\.well-known/|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
