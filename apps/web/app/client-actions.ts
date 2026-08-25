"use server";
import { revalidatePath } from "next/cache";
import { isDemo } from "@/lib/supabase/server";
import { newDemoClient, store } from "@/lib/demo-store";
import { entitlementsFor } from "@buddygym/shared";
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
