"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDemoClient } from "@/app/client-actions";
import { useI18n } from "@/lib/i18n/client";

// Demo-only shortcut. The real path is InviteButton: a client is a person with
// an account who accepts an invite, not a row a coach types in.
export function AddClientButton({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter();
  const { t } = useI18n();
  const m = t.coachWidgets.addClientButton;
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
        setError(m.limitReached);
      } else {
        setError(result.message ?? m.addError);
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? m.limitReachedTitle : undefined}
        className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-accent disabled:opacity-50"
      >
        {m.addClient}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={m.namePlaceholder}
        autoFocus
        className="w-44 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? m.adding : t.common.actions.add}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        className="text-xs text-ink-soft underline"
      >
        {m.cancel}
      </button>
      {error ? <span className="text-sm text-risk">{error}</span> : null}
    </form>
  );
}
