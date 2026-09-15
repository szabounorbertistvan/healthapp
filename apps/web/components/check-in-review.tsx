"use client";
import { useState, useTransition } from "react";
import type { CheckInRow } from "@/lib/types";
import { reviewCheckIn } from "@/app/actions";
import { useI18n } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n";
import { Card } from "./ui";
import { NavIcon } from "./client-nav";

const metrics = ["sleep", "energy", "stress", "hunger", "recovery"] as const;

const CHEVRON = "m9 6 6 6-6 6";

export function CheckInReview({ checkIns }: { checkIns: CheckInRow[] }) {
  const { t, locale } = useI18n();
  const m = t.coachWidgets.checkInReview;
  const [queue, setQueue] = useState(checkIns);
  const [selectedId, setSelectedId] = useState(checkIns[0]?.id ?? null);
  const [feedback, setFeedback] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = queue.find((c) => c.id === selectedId) ?? queue[0] ?? null;

  function submit(markOnly: boolean) {
    if (!selected) return;
    setStatus(null);
    startTransition(async () => {
      const result = await reviewCheckIn(selected.id, selected.client_id, markOnly ? "" : feedback);
      if (result.ok) {
        setStatus(m.feedbackSent);
        const next = queue.filter((c) => c.id !== selected.id);
        setQueue(next);
        setSelectedId(next[0]?.id ?? null);
        setFeedback("");
      } else {
        setStatus(result.message ?? m.somethingWentWrong);
      }
    });
  }

  if (!selected) {
    return (
      <Card plain className="py-10 text-center">
        <p className="text-sm text-ink-soft">{m.allCaughtUp} {status}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
      {/* The queue: one chip per submitted check-in, the open one on the accent. */}
      <div className="flex w-full shrink-0 flex-col gap-2 lg:w-64">
        {queue.map((c) => {
          const open = c.id === selected.id;
          return (
            <button
              key={c.id}
              onClick={() => { setSelectedId(c.id); setFeedback(""); setStatus(null); }}
              className={`flex min-h-11 w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-left ${
                open ? "bg-accent-soft text-ink" : "bg-surface text-ink-soft hover:text-ink"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[14px] ${open ? "font-bold" : "font-semibold"}`}>{c.full_name}</span>
                <span className="block text-[12.5px] tabular-nums text-ink-faint">
                  {new Date(c.submitted_at).toLocaleDateString(locale)}
                </span>
              </span>
              <NavIcon
                d={CHEVRON}
                className={`h-4 w-4 shrink-0 ${open ? "text-accent-ink" : "text-ink-faint"}`}
              />
            </button>
          );
        })}
      </div>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card plain>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.thisWeek}</p>
            <div className="mt-1.5">
              <Row label={m.weight} value={selected.weight_kg ? `${selected.weight_kg} kg` : "—"} />
              {metrics.map((metric) => (
                <Row key={metric} label={m.metric[metric]} value={selected[metric] ?? "—"} />
              ))}
            </div>
          </Card>
          <Card plain className="opacity-70">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.lastWeek}</p>
            {selected.previous ? (
              <div className="mt-1.5">
                <Row label={m.weight} value={selected.previous.weight_kg ? `${selected.previous.weight_kg} kg` : "—"} />
                {metrics.map((metric) => (
                  <Row key={metric} label={m.metric[metric]} value={selected.previous?.[metric] ?? "—"} />
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-ink-soft">{m.firstCheckIn}</p>
            )}
          </Card>
        </div>

        {selected.note ? (
          <Card plain>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.clientNote}</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed">&ldquo;{selected.note}&rdquo;</p>
          </Card>
        ) : null}

        {selected.context ? (
          <Card plain>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.weekContext}</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">{selected.context}</p>
          </Card>
        ) : null}

        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={fill(m.feedbackPlaceholder, { name: selected.full_name })}
          rows={3}
          className="w-full rounded-2xl border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
        />
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => submit(false)}
            disabled={pending || !feedback.trim()}
            className="flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {m.sendAndMark}
          </button>
          <button
            onClick={() => submit(true)}
            disabled={pending}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-surface px-5 text-[12.5px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
          >
            {m.markOnly}
          </button>
          {status ? <span className="text-[13px] text-ink-faint">{status}</span> : null}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line/60 py-2 text-sm last:border-0">
      <span className="text-ink-soft">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
