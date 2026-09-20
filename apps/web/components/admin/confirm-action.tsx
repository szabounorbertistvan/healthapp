"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import type { ActionResult } from "@/app/actions";

/**
 * A button that opens a native <dialog> explaining exactly what will happen,
 * optionally asks for a reason, and only then calls the bound server action.
 * Every sensitive admin write goes through this: the copy names the effect,
 * the dialog is the confirmation, the RPC writes the audit row.
 */
export function ConfirmAction({
  label, title, body, action, tone = "risk", withReason = false, className = "",
}: {
  label: string;
  title: string;
  body: string;
  /** A server action already bound to its ids: `suspendUser.bind(null, id)`. */
  action: (reason: string) => Promise<ActionResult>;
  tone?: "risk" | "accent" | "neutral";
  withReason?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const buttonCls = {
    risk: "bg-risk-soft text-risk hover:opacity-90",
    accent: "bg-accent text-accent-fg hover:opacity-90",
    neutral: "bg-surface text-ink-soft hover:text-ink",
  }[tone];

  function confirm() {
    setError(null);
    start(async () => {
      const result = await action(reason);
      if (!result.ok) {
        setError(result.message ?? t.admin.common.loadError);
        return;
      }
      ref.current?.close();
      setReason("");
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className={`inline-flex h-9 items-center rounded-xl px-3.5 text-[12.5px] font-bold ${buttonCls} ${className}`}>
        {label}
      </button>
      <dialog ref={ref} className="glass glass--strong fixed inset-0 z-50 m-auto h-fit w-[min(28rem,calc(100vw-2rem))] rounded-3xl p-0 text-ink backdrop:bg-bg/70" onClose={() => setError(null)}>
        <form method="dialog" className="p-5" onSubmit={(e) => { e.preventDefault(); confirm(); }}>
          <h2 className="font-display text-lg font-extrabold tracking-tight">{title}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{body}</p>
          {withReason ? (
            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {t.admin.common.reason}
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2}
                className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-2 text-[13px] font-normal normal-case tracking-normal text-ink outline-none focus:border-accent" />
            </label>
          ) : null}
          {error ? <p className="mt-3 text-[12.5px] text-risk">{error}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => ref.current?.close()} disabled={pending} className="inline-flex h-9 items-center rounded-xl px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50">
              {t.admin.common.cancel}
            </button>
            <button type="submit" disabled={pending} className={`inline-flex h-9 items-center rounded-xl px-4 text-[12.5px] font-bold disabled:opacity-50 ${buttonCls}`}>
              {pending ? t.admin.common.working : t.admin.common.confirm}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
