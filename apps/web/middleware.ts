import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/safe-next";
import { userIdFromClient } from "@/lib/supabase/claims";

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
    path.startsWith("/auth/") || path.startsWith("/reset-password") ||
    // precached by the service worker, and shown to whoever is offline
    path === "/offline" ||
    // Coach Discovery: a published coach page is public by design (search
    // engines too). The data behind it comes only from anon-granted RPCs that
    // refuse anything unpublished — the page needs no session.
    path === "/coaches" || path.startsWith("/coaches/") ||
    // what crawlers read first (20261107100000): a redirect to /login here
    // would hide the whole public directory from search engines
    path === "/robots.txt" || path === "/sitemap.xml"
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

export const config = {
  // The worker (/serwist/sw.js) and the manifest are fetched by the browser
  // itself, session or no session (a worker update check runs in the
  // background); a redirect in place of the script would kill the registration.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|serwist/|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
