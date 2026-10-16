// POST /recipes/receive — where DishFinder's "Add to Voinic" button lands.
//
// The form carries p (base64url JSON) and s (its HMAC signature); see
// packages/shared/src/recipe-handoff.ts. Public in middleware on purpose: the
// person may not be signed in yet, and a redirect to /login would drop the
// POST body. Nothing is written here — a verified hand-off is parked in an
// httpOnly cookie for 30 minutes and the person goes to /recipes, where the
// import dialog (behind sign-in) verifies it again and asks what to keep.
import { NextResponse } from "next/server";
import { HANDOFF_MAX_AGE_S } from "@healthapp/shared";
import { HANDOFF_COOKIE, verifyHandoff } from "@/lib/recipe-handoff-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function to(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, request.url), 303);
}

export async function POST(request: Request) {
  let p = "";
  let s = "";
  try {
    const form = await request.formData();
    p = String(form.get("p") ?? "");
    s = String(form.get("s") ?? "");
  } catch {
    return to(request, "/recipes?handoff_error=HANDOFF_MALFORMED");
  }
  const result = verifyHandoff(p, s);
  if (!result.ok) return to(request, `/recipes?handoff_error=${result.error}`);

  const response = to(request, "/recipes?import=1");
  response.cookies.set(HANDOFF_COOKIE, `${p}.${s}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: HANDOFF_MAX_AGE_S,
  });
  return response;
}

/** A GET here is someone opening the address by hand: nothing to receive. */
export function GET(request: Request) {
  return to(request, "/recipes");
}
