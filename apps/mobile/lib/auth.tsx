import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { disablePush } from "./push-token";
import { supabase } from "./supabase";

// The signed-in session, or null; `ready` is false until SecureStore was read,
// so the first frame does not flash the sign-in screen at someone signed in.
type Auth = { ready: boolean; session: Session | null };
const AuthContext = createContext<Auth>({ ready: false, session: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<Auth>({ ready: false, session: null });

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setAuth({ ready: true, session: data.session }))
      .catch(() => setAuth({ ready: true, session: null }));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setAuth({ ready: true, session }));
    return () => data.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  return useContext(AuthContext);
}

export type SignInError = "missing" | "invalid" | "unconfirmed" | "network";

/** Email + password, the same accounts as the web. Google and Apple are lib/oauth.ts. */
export async function signInWithPassword(email: string, password: string): Promise<SignInError | null> {
  if (!email.trim() || !password) return "missing";
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (!error) return null;
    if (error.code === "email_not_confirmed") return "unconfirmed";
    if (error.status === 0 || error.name === "AuthRetryableFetchError") return "network";
    return "invalid";
  } catch {
    return "network";
  }
}

export async function signOut(): Promise<void> {
  // First, while the token still works: this phone stops getting the person's pushes.
  await disablePush();
  // local scope: this phone only — the person's other devices stay signed in.
  await supabase.auth.signOut({ scope: "local" });
}
