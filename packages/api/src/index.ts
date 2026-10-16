// @healthapp/api — one place where the Supabase client is configured and where
// server-raised business rules are decoded (plan §2).
//
// Table types live in src/database.types.ts (import "@healthapp/api/database").
// Regenerate from a local stack with Docker:
//   npm run db:types --workspace=@healthapp/api
// or from the live project, which needs no Docker, while the CLI is logged in:
//   supabase gen types typescript --project-id <ref> > src/database.types.ts
// The shared client stays untyped. Reads adopt the generated types one at a time.
export * from "./errors";
export { createClient, type SupabaseClient } from "@supabase/supabase-js";
