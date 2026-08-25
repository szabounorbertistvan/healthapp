"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDemoClient } from "@/app/client-actions";

// Demo-only shortcut. The real path is InviteButton: a client is a person with
// an account who accepts an invite, not a row a coach types in.
export function AddClientButton({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addDemoClient(name);
      if (result.ok) {
        setName("");
        setOpen(false);
        router.refresh();
      } else if (result.message === "CLIENT_LIMIT_REACHED") {
        setError("Client limit reached for your plan.");
      } else {
        setError(result.message ?? "Could not add the client");
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? "Client limit reached for your plan" : undefined}
        className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-accent disabled:opacity-50"
      >
        + Add client
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Client name"
        autoFocus
        className="w-44 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        className="text-xs text-ink-soft underline"
      >
        cancel
      </button>
      {error ? <span className="text-sm text-risk">{error}</span> : null}
    </form>
  );
}
