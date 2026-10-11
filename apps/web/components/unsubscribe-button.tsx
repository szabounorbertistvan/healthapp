"use client";
import { useState, useTransition } from "react";
import { unsubscribeByLink } from "@/app/email-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { BUTTON } from "@/lib/form-classes";

/** The confirm step on /unsubscribe: one button, then a plain answer. */
export function UnsubscribeButton({ link, category }: { link: { u: string; c: string; t: string }; category: string }) {
  const { t } = useI18n();
  const m = t.common.unsubscribe;
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<"done" | "invalid" | "failed" | null>(null);

  if (outcome === "done") {
    return <p role="status" className="mt-3 text-[14px] leading-relaxed text-accent-ink">{fill(m.done, { category })}</p>;
  }
  if (outcome === "invalid") {
    return <p role="alert" className="mt-3 text-[14px] leading-relaxed text-ink-soft">{m.invalid}</p>;
  }
  return (
    <>
      <p className="mt-3 text-[15px] font-semibold text-ink">{fill(m.question, { category })}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-faint">{m.note}</p>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setOutcome(await unsubscribeByLink(link)))}
        className={`${BUTTON} mt-4`}
      >
        {pending ? "…" : m.confirm}
      </button>
      {outcome === "failed" ? <p role="alert" className="mt-3 text-[12.5px] text-risk">{m.failed}</p> : null}
    </>
  );
}
