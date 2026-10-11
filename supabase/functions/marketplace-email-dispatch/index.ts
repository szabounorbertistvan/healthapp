// HealthApp · marketplace-email-dispatch edge function
//
// Sends the marketplace's transactional email from the email outbox — one
// email per eligible notification (docs/MARKETPLACE_EMAIL.md). Service role
// only, called by a pg_cron tick through pg_net with the URL and key in Vault,
// exactly like rest-push. Everything that decides anything lives in
// ../_shared/email/ and is tested there; this file only wires the database and
// the provider.
//
// NOT ACTIVE. It needs, in order: the outbox migration
// (20261114100000_email_outbox.sql), these secrets, EMAIL_DISPATCH_ENABLED=true
// and the 'marketplace-email-tick' cron job switched on. Until then it answers
// 503 (not configured / disabled) and sends nothing.
//
// Secrets (supabase secrets set …):
//   BREVO_API_KEY           — the Brevo API key (transactional email)
//   EMAIL_FROM              — e.g. "Voinic <notificari@voinic.fit>", a verified sender
//   SITE_URL                — https://www.voinic.fit
//   EMAIL_DISPATCH_ENABLED  — "true" to send; anything else allows dry runs only
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleDispatchRequest, type OutboxRow, type OutboxStore, type OutboxUpdate } from "../_shared/email/dispatch.ts";
import { brevoProvider } from "../_shared/email/provider.ts";

// The caller's own bearer is the client's key: the outbox RPCs are granted to
// service_role alone, so Postgres answers 42501 to anything else (rest-push
// does the same, for the same reason — see handleDispatchRequest).
function supabaseStore(bearer: string): OutboxStore {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, bearer, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rows = async (fn: string, limit: number): Promise<OutboxRow[]> => {
    const { data, error } = await supabase.rpc(fn, { p_limit: limit });
    if (error) throw new Error(`${fn}: ${error.code ?? "error"}`);
    return (data ?? []) as OutboxRow[];
  };
  return {
    async authorize() {
      const { error } = await supabase.rpc("email_outbox_peek", { p_limit: 1 });
      if (!error) return true;
      // 42501: not granted. PGRST301 / 401: a key the API itself rejects.
      if (error.code === "42501" || error.code === "PGRST301") return false;
      throw new Error(`email_outbox_peek: ${error.code ?? "error"}`);
    },
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
    makeProvider: (config) => brevoProvider(config),
  })
);
