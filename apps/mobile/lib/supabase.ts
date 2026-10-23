import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";
import { chunkedStore } from "./chunked-store";
import { config } from "./config";

// One client for the app's lifetime. It is used for auth (and, later, realtime
// messages); reads and writes of the person's data go through /api/v1
// (lib/api.ts), which runs the web's own code for them.
//
// The session lives in SecureStore (Android Keystore-encrypted), split into
// chunks because it outgrows one SecureStore value.
const secure = chunkedStore({
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
});

export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: {
    storage: secure,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// Refresh the access token only while the app is on screen: a background timer
// would be killed by Android anyway, and the next foreground refreshes first.
AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
