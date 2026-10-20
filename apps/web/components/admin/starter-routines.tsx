"use client";
import { useState, useTransition } from "react";
import { createStarterRoutines } from "@/app/admin-actions";
import { settle } from "@/lib/settle-action";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

/** Admin · one button that puts Voinic's four starter routines on Discover (20261207150000). */
export function StarterRoutinesButton() {
  const { t } = useI18n();
  const m = t.admin.workouts.starter;
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={pending}
        onClick={() => start(async () => {
          const r = await settle(() => createStarterRoutines(), t.common.actions.unreachable);
          const created = "created" in r && typeof r.created === "number" ? r.created : 0;
          setStatus(r.ok ? { ok: true, text: created > 0 ? fill(m.created, { n: created }) : m.already } : { ok: false, text: r.message ?? m.failed });
        })}
        className="inline-flex h-10 items-center rounded-xl bg-accent px-4 text-[13px] font-bold text-accent-fg disabled:opacity-50">
        {pending ? m.working : m.button}
      </button>
      <span className="max-w-xl text-[12.5px] text-ink-soft">{m.hint}</span>
      {status ? <span role="status" className={`text-[12.5px] font-semibold ${status.ok ? "text-accent-ink" : "text-risk"}`}>{status.text}</span> : null}
    </div>
  );
}
