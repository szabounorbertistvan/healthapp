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

/**
 * A toggle chip: one choice in a set the person can tick several of
 * (muscle groups, a coach's specializations and languages). A real button with
 * aria-pressed, so it is reachable and readable from the keyboard.
 */
export function Chip({
  on, onToggle, disabled = false, children, className = "",
}: {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onToggle}
      className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold outline-none ring-accent/50 focus-visible:ring-2 disabled:opacity-50 ${
        on ? "bg-accent text-accent-fg" : "bg-bg text-ink-soft hover:text-ink"
      } ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * An on/off setting: the label and hint on the left, the switch on the right.
 * `onLabel` / `offLabel` are the words on the switch itself.
 */
export function Switch({
  checked, onChange, disabled = false, label, hint, onLabel, offLabel, inset = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  hint?: string;
  onLabel: string;
  offLabel: string;
  /** On a `bg-bg` panel: the off state uses the surface colour so the switch stays visible. */
  inset?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[13px] font-semibold text-ink-soft">{label}</p>
        {hint ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-faint">{hint}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`inline-flex h-9 shrink-0 items-center justify-center rounded-xl px-3.5 text-[13px] font-semibold outline-none ring-accent/50 focus-visible:ring-2 disabled:opacity-50 ${
          checked ? "bg-accent-soft text-accent-ink" : inset ? "bg-surface text-ink-faint" : "bg-bg text-ink-faint"
        }`}
      >
        {checked ? onLabel : offLabel}
      </button>
    </div>
  );
}
