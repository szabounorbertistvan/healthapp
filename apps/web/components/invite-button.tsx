"use client";
import { useState, useTransition } from "react";
import { createInvite } from "@/app/actions";
import { useI18n } from "@/lib/i18n/client";

export function InviteButton({ disabled = false }: { disabled?: boolean }) {
  const { t } = useI18n();
  const m = t.coachWidgets.inviteButton;
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await createInvite();
      if (result.ok && result.code) setCode(result.code);
      else if (result.message?.includes("CLIENT_LIMIT_REACHED"))
        setError(m.limitReachedUpgrade);
      // Anything else is an infrastructure fault, not something a coach can act
      // on: "function gen_random_bytes(integer) does not exist" was reaching
      // this span verbatim. The raw text is logged server-side in createInvite.
      else setError(m.createError);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {code ? (
        <span className="inline-flex h-9 items-center gap-2 rounded-full bg-accent-soft px-3.5 text-[13px] font-bold tabular-nums tracking-widest text-accent-ink">
          {code}
          <button
            className="text-[11px] font-semibold uppercase tracking-wider underline underline-offset-2 hover:opacity-80"
            onClick={() => navigator.clipboard.writeText(code)}
          >
            {m.copy}
          </button>
        </span>
      ) : null}
      {error ? <span className="text-[12.5px] text-risk">{error}</span> : null}
      <button
        onClick={onClick}
        disabled={pending || disabled}
        title={disabled ? m.limitReachedTitle : undefined}
        className="flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
      >
        {pending ? m.generating : m.inviteClient}
      </button>
    </div>
  );
}
