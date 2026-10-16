import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@healthapp/api/database";

/** The request's Supabase client, read through the generated schema. */
export type Db = SupabaseClient<Database>;

export function typedDb(client: unknown): Db {
  return client as Db;
}
