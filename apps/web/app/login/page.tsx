"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { isDemo, supabaseBrowser } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isDemo) {
      router.push("/dashboard");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    const { error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) setError(error.message);
    else router.push("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent font-black text-white">B</span>
          <span className="text-xl font-extrabold tracking-tight">BuddyGym Coach</span>
        </div>
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-surface p-5">
          {isDemo ? (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
              Demo mode — sign-in is skipped. Connect Supabase to enable real auth.
            </p>
          ) : null}
          <input
            type="email" required={!isDemo} value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="Email"
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <input
            type="password" required={!isDemo} value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="Password"
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {error ? <p className="text-sm text-risk">{error}</p> : null}
          <button
            type="submit" disabled={busy}
            className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="w-full text-center text-xs text-ink-soft hover:underline"
          >
            {mode === "signin" ? "New coach? Create an account" : "Already have an account? Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
