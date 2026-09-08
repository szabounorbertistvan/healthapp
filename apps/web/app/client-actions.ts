"use server";
import { revalidatePath } from "next/cache";
import { isDemo, supabaseServer } from "@/lib/supabase/server";
import { newDemoClient, store } from "@/lib/demo-store";
import { entitlementsFor } from "@healthapp/shared";
import { rpcErrorCode } from "@healthapp/api";
import { cookies } from "next/headers";
import { ONBOARDING_COOKIE, ONBOARDING_COOKIE_MAX_AGE } from "@/lib/onboarding";
import { getProfile } from "@/lib/data";
import type { ActionResult } from "./actions";

/**
 * Add a client to the demo roster.
 *
 * Demo only, and deliberately so: in a live install a client is a real user
 * account. The coach cannot conjure one — they generate an invite code and the
 * client accepts it in the mobile app (spec A2/A3, accept_invite). This exists
 * because demo mode has no second person to accept anything.
 */
export async function addDemoClient(fullName: string): Promise<ActionResult> {
  const name = fullName.trim();
  if (!name) return { ok: false, message: "Give the client a name" };

  if (!isDemo) {
    return {
      ok: false,
      message: "Clients join by accepting an invite — use Invite client.",
    };
  }

  const profile = await getProfile();
  const maxClients = entitlementsFor(profile?.tier ?? "free").maxClients;
  const used = store().clients.filter((c) => c.status !== "ended").length;
  // Same rule create_invite enforces in SQL, so demo cannot exceed what the
  // server would allow.
  if (used >= maxClients) return { ok: false, message: "CLIENT_LIMIT_REACHED" };

  store().clients.push(newDemoClient(name));
  revalidatePath("/clients");
  revalidatePath("/dashboard");
  return { ok: true, demo: true };
}

/**
 * Claim a coach's invite code. The rules — unknown code, expired, already
 * coached — are enforced by the accept_invite() function in the database, and
 * its raised codes are decoded by @healthapp/api. The result carries the
 * business `code` (INVALID_CODE / EXPIRED / ALREADY_HAS_COACH / UNKNOWN) and the
 * caller picks the localized copy — the raw Postgres message never reaches a
 * screen.
 */
export async function acceptInvite(code: string): Promise<ActionResult> {
  const clean = code.trim().toUpperCase();
  if (!clean) return { ok: false, code: "INVALID_CODE" };
  if (isDemo) return { ok: true, demo: true };

  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("accept_invite", { p_code: clean });
  if (error) return { ok: false, code: rpcErrorCode(error) ?? "UNKNOWN", message: error.message };
  revalidatePath("/today");
  return { ok: true };
}

/**
 * Remember that the client chose to train on their own.
 *
 * Without this, a client who picks "I train on my own" but leaves the builder
 * before creating a program still has an empty account, so /today would send
 * them back to /welcome on every visit. The choice is a cookie rather than a
 * column: it is a UI preference about which screen to show, not user data,
 * and it needs no migration. Joining a coach or building a program makes the
 * account non-empty, at which point the cookie is simply irrelevant.
 */
export async function chooseSoloTraining(): Promise<ActionResult> {
  const jar = await cookies();
  jar.set(ONBOARDING_COOKIE, "solo", {
    maxAge: ONBOARDING_COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return { ok: true, demo: isDemo };
}
