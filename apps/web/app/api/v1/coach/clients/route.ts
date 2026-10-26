import type { CoachClientsV1, CoachClientsWriteV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { createInvite } from "@/app/actions";
import { bulkClientAction } from "@/app/bulk-actions";
import { getCoachClientRelationships } from "@/lib/coaching-data";
import { getClients, getPrograms } from "@/lib/data";
import { getPlan } from "@/lib/plan";

// The coach's clients — the web's /clients: the roster (each row as the page
// shows it), the plan's slots, the paused and past relationships, and what the
// bulk dialog offers. POST: invite (createInvite, a fresh code) or bulk
// (bulkClientAction: a message, a habit or a program copy for several clients).
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [clients, plan, relationships, programs] = await Promise.all([
    getClients(), getPlan(), getCoachClientRelationships("all"),
    // the bulk "copy a program" picker; a failed read only hides that option
    getPrograms().catch(() => []),
  ]);
  return apiJson<CoachClientsV1>({
    clients: clients.map((c) => ({
      client_id: c.client_id, name: c.full_name, status: c.status, signal: c.signal, overall_pct: c.overall_pct,
      last_activity: c.last_activity, started_at: c.started_at, load_7d: c.load_7d, next_booking_at: c.next_booking_at ?? null,
    })),
    slots: { used: clients.length, max: plan.e.maxClients },
    pro: plan.e.advancedAnalytics,
    can_copy_programs: plan.e.programCopy,
    programs: programs.map((p) => ({ id: p.id, name: p.name, client: p.client_name })),
    relationships: relationships.filter((r) => r.status === "paused" || r.status === "ended"),
  });
});

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { op?: unknown; input?: unknown } | null;
  if (b?.op === "invite") {
    const r = await createInvite();
    // the screen shows business codes only: an infrastructure fault is not something a coach can act on
    const limit = !r.ok && r.message?.includes("CLIENT_LIMIT_REACHED");
    return apiJson<CoachClientsWriteV1>({ ok: r.ok, code: r.code, errorCode: r.ok ? undefined : limit ? "CLIENT_LIMIT_REACHED" : "INVITE_FAILED" });
  }
  if (b?.op === "bulk") {
    const r = await bulkClientAction(b.input as Parameters<typeof bulkClientAction>[0]);
    return apiJson<CoachClientsWriteV1>({ ok: r.ok, message: r.message, errorCode: r.errorCode, done: r.done, failed: r.failed });
  }
  return apiJson<CoachClientsWriteV1>({ ok: false, errorCode: "INVALID_INPUT" }, 400);
});
