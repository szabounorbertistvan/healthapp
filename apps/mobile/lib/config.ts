// Public build-time configuration (Expo inlines EXPO_PUBLIC_* — see .env.example).
// A missing value is a build fault, so it fails loudly on first use, with the
// variable's name, rather than as an opaque network error later.

function required(name: string, value: string | undefined): string {
  const v = value?.trim();
  if (!v) throw new Error(`${name} is not set: copy apps/mobile/.env.example to apps/mobile/.env`);
  return v;
}

export const config = {
  get supabaseUrl() {
    return required("EXPO_PUBLIC_SUPABASE_URL", process.env.EXPO_PUBLIC_SUPABASE_URL);
  },
  get supabaseAnonKey() {
    return required("EXPO_PUBLIC_SUPABASE_ANON_KEY", process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  },
  /** The web app serving /api/v1. */
  get apiUrl() {
    return (process.env.EXPO_PUBLIC_API_URL?.trim() || "https://www.voinic.fit").replace(/\/+$/, "");
  },
  webUrl: "https://www.voinic.fit",
};
