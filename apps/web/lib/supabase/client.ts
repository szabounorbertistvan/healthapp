"use client";
import { createBrowserClient } from "@supabase/ssr";

// Trimmed on the way in. These two are inlined into the browser bundle and then
// handed to fetch as the `apikey` and `Authorization` header values, where only
// ISO-8859-1 is legal. A value pasted into a dashboard with a leading BOM
// (U+FEFF) or a trailing newline makes every request fail with "String contains
// non ISO-8859-1 code point" — trim() removes both.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

export const isDemo = !url;

export function supabaseBrowser() {
  return createBrowserClient(url, anonKey);
}
