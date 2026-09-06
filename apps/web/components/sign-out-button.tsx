"use client";
import { useTransition } from "react";
import { signOut } from "@/app/auth-actions";

/**
 * Sign out. Styling is passed in because this sits in two very different
 * places: the sidebar footer, where it reads as one more nav row, and the
 * phone header, where it is a compact link next to the client's name.
 */
export function SignOutButton({ className }: { className?: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => { await signOut(); })}
      className={
        className ??
        "w-full rounded-lg px-3 py-2 text-left text-sm text-ink-soft hover:bg-bg disabled:opacity-50"
      }
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
