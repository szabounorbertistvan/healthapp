"use client";
import type { Signal } from "@/lib/types";
import { useI18n } from "@/lib/i18n/client";

export function SignalBadge({ signal }: { signal: Signal }) {
  const { t } = useI18n();
  const styles: Record<Signal, string> = {
    on_track: "bg-accent-soft text-accent-ink",
    needs_attention: "bg-warn-soft text-warn",
    at_risk: "bg-risk-soft text-risk",
  };
  return (
    <span className={`inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ${styles[signal]}`}>
      {t.common.signal[signal]}
    </span>
  );
}

/**
 * A card is a Liquid Glass pane (app/globals.css `.glass`): translucent over
 * the page, a lit rim, a soft shadow. `plain` is the client app's larger
 * radius; the coach surfaces keep the tighter one. Neither draws a border of
 * its own any more — the pane's rim is the edge.
 */
export function Card({ children, className = "", plain = false }: { children: React.ReactNode; className?: string; plain?: boolean }) {
  return (
    <div className={`${plain ? "rounded-3xl" : "rounded-xl"} glass p-4 ${className}`}>
      {children}
    </div>
  );
}

export function StatCard({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <Card className="flex-1 min-w-32">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accent ? "text-accent-ink" : ""}`}>{value}</p>
    </Card>
  );
}

export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      {children}
    </div>
  );
}

/** `plain` matches the redesigned client cards (no border, larger radius). */
export function EmptyState({ title, hint, plain = false }: { title: string; hint: string; plain?: boolean }) {
  return (
    <Card plain={plain} className="py-10 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-ink-soft">{hint}</p>
    </Card>
  );
}
