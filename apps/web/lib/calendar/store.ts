import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarErrorCode } from "@healthapp/shared";
import type { CalendarSyncStore, StoredCredentials } from "./sync";
import type { TokenSet } from "./provider";
import { decryptToken, encryptToken, type TokenKey } from "./token-crypto";

/**
 * CalendarSyncStore over the service-role client: the only code that ever
 * holds a decrypted token. Tokens are encrypted with the connection id bound
 * in (token-crypto.ts) before they leave this process.
 */
export function serviceCalendarStore(db: SupabaseClient, keys: TokenKey[], writeKey: TokenKey): CalendarSyncStore & {
  saveInitial(connectionId: string, tokens: TokenSet): Promise<void>;
} {
  async function writeTokens(connectionId: string, tokens: TokenSet, keepRefresh: boolean) {
    const row: Record<string, unknown> = {
      connection_id: connectionId,
      access_token_enc: encryptToken(tokens.accessToken, writeKey, connectionId),
      access_token_expires_at: tokens.expiresAt.toISOString(),
      key_version: writeKey.version,
    };
    if (tokens.refreshToken) row.refresh_token_enc = encryptToken(tokens.refreshToken, writeKey, connectionId);
    else if (!keepRefresh) row.refresh_token_enc = null;
    const { error } = await db.from("calendar_credentials").upsert(row, { onConflict: "connection_id" });
    if (error) throw new Error("calendar credentials could not be saved");
  }

  return {
    async credentials(connectionId): Promise<StoredCredentials | null> {
      const { data, error } = await db
        .from("calendar_credentials")
        .select("access_token_enc, refresh_token_enc, access_token_expires_at")
        .eq("connection_id", connectionId)
        .maybeSingle();
      if (error || !data || !data.access_token_enc) return null;
      return {
        accessToken: decryptToken(data.access_token_enc, keys, connectionId),
        refreshToken: data.refresh_token_enc ? decryptToken(data.refresh_token_enc, keys, connectionId) : null,
        expiresAt: data.access_token_expires_at ? new Date(data.access_token_expires_at) : null,
      };
    },
    saveTokens: (connectionId, tokens) => writeTokens(connectionId, tokens, true),
    saveInitial: (connectionId, tokens) => writeTokens(connectionId, tokens, false),
    async affectingCalendars(connectionId) {
      const { data } = await db
        .from("calendar_sources")
        .select("external_id")
        .eq("connection_id", connectionId)
        .eq("affects_availability", true);
      return (data ?? []).map((r) => r.external_id as string);
    },
    async apply({ connectionId, calendars, busy, window, nextSyncAt }) {
      const { error } = await db.rpc("calendar_sync_apply", {
        p_connection: connectionId,
        p_calendars: calendars.map((c) => ({ id: c.id, name: c.name, primary: c.primary })),
        p_busy: busy,
        p_from: window.start.toISOString(),
        p_to: window.end.toISOString(),
        p_next_sync_at: nextSyncAt.toISOString(),
      });
      if (error) throw new Error("calendar sync could not be applied");
    },
    async fail(connectionId, code: CalendarErrorCode, retryAt) {
      await db.rpc("calendar_sync_failed", { p_connection: connectionId, p_code: code, p_retry_at: retryAt?.toISOString() ?? null });
    },
  };
}
