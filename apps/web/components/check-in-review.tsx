"use client";
import { useState, useTransition } from "react";
import type { CheckInRow } from "@/lib/types";
import { reviewCheckIn } from "@/app/actions";
import { useI18n } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n";

const metrics = ["sleep", "energy", "stress", "hunger", "recovery"] as const;

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
        setStatus(result.demo ? m.demoNothingSaved : m.feedbackSent);
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
    return <p className="text-sm text-ink-soft">{m.allCaughtUp} {status}</p>;
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="flex w-full flex-col gap-2 lg:w-56">
        {queue.map((c) => (
          <button
            key={c.id}
            onClick={() => { setSelectedId(c.id); setFeedback(""); setStatus(null); }}
            className={`rounded-xl border p-3 text-left text-sm ${
              c.id === selected.id ? "border-accent bg-surface font-semibold" : "border-line bg-surface text-ink-soft hover:border-ink-faint"
            }`}
          >
            {c.full_name}
            <span className="block text-xs font-normal text-ink-faint">
              {new Date(c.submitted_at).toLocaleDateString(locale)}
            </span>
          </button>
        ))}
      </div>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.thisWeek}</p>
            <Row label={m.weight} value={selected.weight_kg ? `${selected.weight_kg} kg` : "—"} />
            {metrics.map((metric) => (
              <Row key={metric} label={m.metric[metric]} value={selected[metric] ?? "—"} />
            ))}
          </div>
          <div className="rounded-xl border border-line bg-surface p-4 opacity-70">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.lastWeek}</p>
            {selected.previous ? (
              <>
                <Row label={m.weight} value={selected.previous.weight_kg ? `${selected.previous.weight_kg} kg` : "—"} />
                {metrics.map((metric) => (
                  <Row key={metric} label={m.metric[metric]} value={selected.previous?.[metric] ?? "—"} />
                ))}
              </>
            ) : (
              <p className="mt-2 text-sm text-ink-soft">{m.firstCheckIn}</p>
            )}
          </div>
        </div>

        {selected.note ? (
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.clientNote}</p>
            <p className="mt-1 text-sm">&ldquo;{selected.note}&rdquo;</p>
          </div>
        ) : null}

        {selected.context ? (
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.weekContext}</p>
            <p className="mt-1 text-sm text-ink-soft">{selected.context}</p>
          </div>
        ) : null}

        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={fill(m.feedbackPlaceholder, { name: selected.full_name })}
          rows={3}
          className="w-full rounded-xl border border-line bg-surface p-3 text-sm outline-none focus:border-accent"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={() => submit(false)}
            disabled={pending || !feedback.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {m.sendAndMark}
          </button>
          <button
            onClick={() => submit(true)}
            disabled={pending}
            className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft hover:border-ink-faint"
          >
            {m.markOnly}
          </button>
          {status ? <span className="text-sm text-ink-soft">{status}</span> : null}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between border-b border-line py-1.5 text-sm last:border-0">
      <span className="text-ink-soft">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
