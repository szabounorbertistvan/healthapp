"use client";
import { useState, useTransition } from "react";
import { createInvite } from "@/app/actions";

export function InviteButton() {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await createInvite();
      if (result.ok && result.code) setCode(result.code);
      else setError(result.message ?? "Could not create invite");
    });
  }

  return (
    <div className="flex items-center gap-3">
      {code ? (
        <span className="rounded-lg bg-accent-soft px-3 py-1.5 text-sm font-semibold tracking-widest text-accent-ink">
          {code}
          <button
            className="ml-2 text-xs font-normal underline"
            onClick={() => navigator.clipboard.writeText(code)}
          >
            copy
          </button>
        </span>
      ) : null}
      {error ? <span className="text-sm text-risk">{error}</span> : null}
      <button
        onClick={onClick}
        disabled={pending}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Generating…" : "Invite client"}
      </button>
    </div>
  );
}
