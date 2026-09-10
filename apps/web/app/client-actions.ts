"use server";
import { revalidatePath } from "next/cache";
import { isDemo, supabaseServer } from "@/lib/supabase/server";
import { newDemoClient, store } from "@/lib/demo-store";
import { entitlementsFor } from "@healthapp/shared";
import { rpcErrorCode, type RpcErrorCode } from "@healthapp/api";
import { cookies } from "next/headers";
import { ONBOARDING_COOKIE, ONBOARDING_COOKIE_MAX_AGE } from "@/lib/onboarding";
import { getProfile } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
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
  const { t } = await getI18n();
  const m = t.coachWidgets.addClientButton;
  const name = fullName.trim();
  if (!name) return { ok: false, message: m.nameRequired };

  if (!isDemo) return { ok: false, message: m.inviteOnly };

  const profile = await getProfile();
  const maxClients = entitlementsFor(profile?.tier ?? "free").maxClients;
  const used = store().clients.filter((c) => c.status !== "ended").length;
  // Same rule create_invite enforces in SQL, so demo cannot exceed what the
  // server would allow.
  if (used >= maxClients) return { ok: false, errorCode: "CLIENT_LIMIT_REACHED" };

  store().clients.push(newDemoClient(name));
  revalidatePath("/clients");
  revalidatePath("/dashboard");
  return { ok: true, demo: true };
}

/** acceptInvite only ever raises the invite RPC codes, so the screen's copy table can be exhaustive over them. */
export type InviteResult = ActionResult & { errorCode?: RpcErrorCode };

/**
 * Claim a coach's invite code. The rules — unknown code, expired, already
 * coached — are enforced by the accept_invite() function in the database, and
 * its raised codes are decoded by @healthapp/api. The result carries the
 * business `errorCode` (INVALID_CODE / EXPIRED / ALREADY_HAS_COACH / UNKNOWN)
 * and the caller pairs it with localized copy through inviteMessage() — the raw
 * Postgres message never leaves the server.
 */
export async function acceptInvite(code: string): Promise<InviteResult> {
  const clean = code.trim().toUpperCase();
  if (!clean) return { ok: false, errorCode: "INVALID_CODE" };
  if (isDemo) return { ok: true, demo: true };

  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("accept_invite", { p_code: clean });
  if (error) {
    // The raw Postgres text stays on the server. It is useful to us and
    // meaningless to a client, and anything returned here crosses into the
    // browser payload whether a screen renders it or not.
    console.error("accept_invite failed:", error.message);
    return { ok: false, errorCode: rpcErrorCode(error) ?? "UNKNOWN" };
  }
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
