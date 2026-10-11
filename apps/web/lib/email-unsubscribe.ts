import "server-only";
import { parseEmailUnsubscribe } from "@healthapp/shared";
import { supabasePublic } from "@/lib/supabase/server";

export type UnsubscribeOutcome = "done" | "invalid" | "failed";

/**
 * Switches off one email category from the link at the foot of an email —
 * the page's button and the mail client's one-click POST both land here. It
 * runs as `anon` on purpose: the database checks the token
 * (email_unsubscribe(), 20261115100000), so whoever is or is not signed in in
 * this browser changes nothing.
 */
export async function unsubscribeWithLink(params: { u?: unknown; c?: unknown; t?: unknown }): Promise<UnsubscribeOutcome> {
  const link = parseEmailUnsubscribe(params);
  if (!link) return "invalid";
  const { data, error } = await supabasePublic().rpc("email_unsubscribe", {
    p_user: link.userId,
    p_category: link.category,
    p_token: link.token,
  });
  if (error) {
    console.error(`email_unsubscribe failed: ${error.code ?? "error"}`);
    return "failed";
  }
  return data === true ? "done" : "invalid";
}
