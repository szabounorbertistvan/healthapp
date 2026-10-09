// HealthApp · marketplace-email-dispatch edge function
//
// Sends the marketplace's transactional email from the email outbox — one
// email per eligible notification (docs/MARKETPLACE_EMAIL.md). Service role
// only, called by a pg_cron tick through pg_net with the URL and key in Vault,
// exactly like rest-push. Everything that decides anything lives in
// ../_shared/email/ and is tested there; this file only wires the database and
// the provider.
//
// NOT ACTIVE. It needs, in order: the outbox migration (the proposal is in
// supabase/proposals/), these secrets, and EMAIL_DISPATCH_ENABLED=true. Until
// then it answers 503 (not configured / disabled) or 500 (no outbox RPCs) and
// sends nothing.
//
// Secrets (supabase secrets set …):
//   RESEND_API_KEY          — the provider key (sending-only scope)
//   EMAIL_FROM              — e.g. "Voinic <notificari@voinic.fit>", a verified sender
//   SITE_URL                — https://www.voinic.fit
//   EMAIL_DISPATCH_ENABLED  — "true" to send; anything else allows dry runs only
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleDispatchRequest, type OutboxRow, type OutboxStore, type OutboxUpdate } from "../_shared/email/dispatch.ts";
import { resendProvider } from "../_shared/email/provider.ts";

function supabaseStore(): OutboxStore {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const rows = async (fn: string, limit: number): Promise<OutboxRow[]> => {
    const { data, error } = await supabase.rpc(fn, { p_limit: limit });
    if (error) throw new Error(`${fn}: ${error.code ?? "error"}`);
    return (data ?? []) as OutboxRow[];
  };
  return {
    claim: (limit) => rows("email_outbox_claim", limit),
    peek: (limit) => rows("email_outbox_peek", limit),
    async mark(u: OutboxUpdate) {
      const { error } = await supabase.rpc("email_outbox_mark", {
        p_id: u.id,
        p_status: u.status,
        p_reason: u.status === "skipped" ? u.reason : null,
        p_not_before: u.status === "pending" || u.status === "retry" ? u.notBefore : null,
        p_last_status: u.status === "sent" || u.status === "retry" || u.status === "failed" ? u.lastStatus : null,
        p_error_code: u.status === "retry" || u.status === "failed" ? u.errorCode : null,
        p_provider_message_id: u.status === "sent" ? u.providerMessageId : null,
      });
      if (error) throw new Error(`email_outbox_mark: ${error.code ?? "error"}`);
    },
  };
}

Deno.serve((req) =>
  handleDispatchRequest(req, {
    env: (name) => Deno.env.get(name),
    makeStore: supabaseStore,
    makeProvider: (config) => resendProvider(config),
  })
);
