// @buddygym/api — one place where the Supabase client is configured and where
// server-raised business rules are decoded (plan §2).
//
// Table types are generated from the live schema, not hand-written:
//   npm run db:types --workspace=@buddygym/api   (requires a running local stack)
// Until that file exists the client is untyped; generating it is a Phase 0 task
// that needs Docker, which the repo does not yet assume.
export * from "./errors";
export { createClient, type SupabaseClient } from "@supabase/supabase-js";
