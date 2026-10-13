import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { checkEditAccess, type EditAccess } from "@/lib/edit-access";

/**
 * Whether the signed-in user may change a program or a nutrition plan, asked of
 * the same database functions the write policies use (can_edit_program,
 * can_edit_nutrition_plan — 20261122100000), so the screen cannot disagree
 * with what the server will accept. A coach whose coaching ended or is paused
 * gets "read-only"; the policies refuse the writes regardless.
 *
 * Fail-closed (lib/edit-access.ts): only an explicit yes opens the editor. A
 * check that errors, times out or answers anything but a boolean is
 * "unverified" and the page shows the editor read-only with a reload hint —
 * including on a database without 20261122100000 (PGRST202 for
 * can_edit_nutrition_plan), so that migration ships before this code.
 */
export async function canEdit(fn: "can_edit_program" | "can_edit_nutrition_plan", args: Record<string, string>): Promise<EditAccess> {
  return checkEditAccess(async () => {
    const supabase = await supabaseServer();
    return supabase.rpc(fn, args);
  });
}
