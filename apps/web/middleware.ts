import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Trimmed for the same reason as lib/supabase/client.ts: these become header
// values, which may only hold ISO-8859-1, and a BOM pasted into the deployment
// environment would make every call from here fail.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

export async function middleware(request: NextRequest) {
  // Demo mode: no backend, no auth gate
  if (!url) return NextResponse.next();

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

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;

  // getUser() above may have refreshed an expired session, and the refreshed
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
    path.startsWith("/auth/") || path.startsWith("/reset-password")
  ) return response;
  const isLanding = path === "/";
  const isLogin = path.startsWith("/login");

  // logged-out users see only the landing page (and login)
  if (!data.user && !isLanding && !isLogin) {
    return redirect("/");
  }
  // logged-in users skip the login page. The landing page stays reachable
  // (the logo links to it); it shows an "open the app" button instead of sign-in.
  if (data.user && isLogin) {
    return redirect("/dashboard");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
