// Server-safe building blocks for the admin pages: KPI tiles, sections,
// tables, pills, pagers, definition lists and the two formatters. No hooks —
// everything here renders on the server with the dictionary passed in.
import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { Avatar } from "@/components/social";
import { NavIcon } from "@/components/client-nav";

export function fmtDate(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtNum(n: number | null | undefined, locale: Locale, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString(locale, { maximumFractionDigits: digits });
}

/** Page header: title on the left, controls (a filter form, a window picker) on the right. */
export function AdminHeader({ title, intro, children }: { title: string; intro?: string; children?: React.ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{title}</h1>
        {intro ? <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-soft">{intro}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

/** A titled block of the page. */
export function Section({ title, hint, children, className = "", actions }: { title: string; hint?: string; children: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  return (
    <section className={`glass rounded-3xl p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{title}</h2>
          {hint ? <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">{hint}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** One number with its label. `unavailable` renders the honest dash + hint instead of a fake zero. */
export function Kpi({ label, value, sub, accent = false, unavailable, warn = false }: {
  label: string; value: React.ReactNode; sub?: string; accent?: boolean; unavailable?: string; warn?: boolean;
}) {
  return (
    <div className="glass glass--subtle rounded-2xl px-3.5 py-3">
      <p className="text-[10.5px] font-semibold uppercase leading-snug tracking-wider text-ink-faint">{label}</p>
      {unavailable ? (
        <p className="mt-1 font-display text-[22px] font-extrabold leading-none text-ink-faint" title={unavailable}>—</p>
      ) : (
        <p className={`mt-1 font-display text-[22px] font-extrabold tabular-nums leading-none ${accent ? "text-accent-ink" : warn ? "text-warn" : ""}`}>{value}</p>
      )}
      {sub ? <p className="mt-1 text-[11.5px] text-ink-faint">{sub}</p> : null}
      {unavailable ? <p className="mt-1 text-[11px] text-ink-faint">{unavailable}</p> : null}
    </div>
  );
}

export function KpiGrid({ children, cols = 4 }: { children: React.ReactNode; cols?: 2 | 3 | 4 | 5 | 6 }) {
  const cls = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4", 5: "sm:grid-cols-5", 6: "sm:grid-cols-3 lg:grid-cols-6" }[cols];
  return <div className={`grid grid-cols-2 gap-2.5 ${cls}`}>{children}</div>;
}

/** Small status label. */
export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "accent" | "warn" | "risk" }) {
  const cls = {
    neutral: "bg-bg text-ink-soft",
    accent: "bg-accent-soft text-accent-ink",
    warn: "bg-warn-soft text-warn",
    risk: "bg-risk-soft text-risk",
  }[tone];
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

/** A horizontally scrollable table with the panel's header styling. */
export function Table({ head, children, empty }: { head: React.ReactNode; children: React.ReactNode; empty?: string | null }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:-mx-5">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-wider text-ink-faint">{head}</tr>
        </thead>
        <tbody className="divide-y divide-line/60">
          {empty ? (
            <tr><td colSpan={99} className="px-5 py-8 text-center text-sm text-ink-soft">{empty}</td></tr>
          ) : children}
        </tbody>
      </table>
    </div>
  );
}

export function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 pb-2 pt-1 font-semibold first:pl-5 last:pr-5 ${className}`}>{children}</th>;
}

export function Td({ children, className = "", nowrap = false }: { children?: React.ReactNode; className?: string; nowrap?: boolean }) {
  return <td className={`px-3 py-2.5 align-middle first:pl-5 last:pr-5 ${nowrap ? "whitespace-nowrap" : ""} ${className}`}>{children}</td>;
}

/** Name + username + avatar, linking to the user page. */
export function UserCell({ id, name, username, avatar, sub }: { id: string | null; name: string | null; username: string | null; avatar?: string | null; sub?: React.ReactNode }) {
  const label = username ? `@${username}` : name ?? "—";
  const inner = (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={name ?? username ?? "?"} url={avatar ?? null} size="h-8 w-8" />
      <span className="min-w-0">
        <span className="block truncate font-semibold">{label}</span>
        {(username && name) || sub ? <span className="block truncate text-[11.5px] text-ink-faint">{sub ?? name}</span> : null}
      </span>
    </span>
  );
  return id ? <Link href={`/admin/users/${id}`} className="hover:text-accent-ink">{inner}</Link> : inner;
}

/** Definition list, two columns on desktop. */
export function Facts({ items }: { items: { label: string; value: React.ReactNode; mono?: boolean }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label} className="flex items-baseline justify-between gap-3 border-b border-line/50 pb-1.5">
          <dt className="shrink-0 text-[12px] text-ink-faint">{it.label}</dt>
          <dd className={`min-w-0 truncate text-right text-[13px] ${it.mono ? "font-mono text-[12px]" : ""}`} title={typeof it.value === "string" ? it.value : undefined}>
            {it.value ?? "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Previous / next links for a paginated list. */
export function Pager({ page, pages, first, last, total, href, labels }: {
  page: number; pages: number; first: number; last: number; total: number;
  href: (page: number) => string; labels: { showing: string; previous: string; next: string };
}) {
  const cls = "inline-flex h-9 items-center rounded-full px-3.5 text-[12.5px] font-semibold";
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-ink-faint">
      <span className="tabular-nums">{labels.showing.replace("{first}", String(first)).replace("{last}", String(last)).replace("{total}", String(total))}</span>
      <span className="flex items-center gap-1.5">
        {page > 1 ? <Link href={href(page - 1)} className={`${cls} bg-surface text-ink-soft hover:text-ink`}>{labels.previous}</Link> : <span className={`${cls} opacity-40`}>{labels.previous}</span>}
        <span className="tabular-nums">{page} / {pages}</span>
        {page < pages ? <Link href={href(page + 1)} className={`${cls} bg-surface text-ink-soft hover:text-ink`}>{labels.next}</Link> : <span className={`${cls} opacity-40`}>{labels.next}</span>}
      </span>
    </div>
  );
}

/** A GET filter form's select, keeping the current value. */
export function Select({ name, value, options, label, allLabel }: { name: string; value: string | null; options: { value: string; label: string }[]; label: string; allLabel: string }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
      {label}
      <select name={name} defaultValue={value ?? ""} className="h-9 rounded-xl border border-line bg-surface px-2.5 text-[13px] font-medium normal-case tracking-normal text-ink outline-none focus:border-accent">
        <option value="">{allLabel}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function SearchInput({ name = "q", value, placeholder }: { name?: string; value: string | null; placeholder: string }) {
  return (
    <label className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-xl bg-bg px-3">
      <NavIcon d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3" className="h-4 w-4 shrink-0 text-ink-faint" />
      <input type="search" name={name} defaultValue={value ?? ""} placeholder={placeholder} aria-label={placeholder} className="w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-ink-faint" />
    </label>
  );
}

export function FilterButtons({ submit, clearHref, clear }: { submit: string; clearHref: string; clear: string }) {
  return (
    <span className="flex items-end gap-2">
      <button type="submit" className="inline-flex h-9 items-center rounded-xl bg-accent px-4 text-[12.5px] font-bold text-accent-fg hover:opacity-90">{submit}</button>
      <Link href={clearHref} className="inline-flex h-9 items-center rounded-xl px-3 text-[12.5px] font-semibold text-ink-soft hover:text-ink">{clear}</Link>
    </span>
  );
}

/** A window picker (7 / 14 / 30 / 90 days) as links. */
export function DaysPicker({ days, options, href, label }: { days: number; options: readonly number[]; href: (d: number) => string; label: (d: number) => string }) {
  return (
    <span className="inline-flex rounded-full bg-surface p-0.5">
      {options.map((d) => (
        <Link key={d} href={href(d)} className={`inline-flex h-8 items-center rounded-full px-3 text-[12px] font-semibold ${d === days ? "bg-accent-soft text-accent-ink" : "text-ink-soft hover:text-ink"}`}>
          {label(d)}
        </Link>
      ))}
    </span>
  );
}

/** Key → count pairs (jsonb_object_agg results) as a compact list with bars. */
export function Breakdown({ data, labels, locale }: { data: Record<string, number>; labels?: Record<string, string>; locale: Locale }) {
  const entries = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  if (entries.length === 0) return <p className="text-[13px] text-ink-faint">—</p>;
  return (
    <ul className="space-y-1.5">
      {entries.map(([k, v]) => (
        <li key={k} className="text-[12.5px]">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate">{labels?.[k] ?? k}</span>
            <span className="tabular-nums text-ink-soft">{fmtNum(v, locale)}</span>
          </div>
          <div className="mt-0.5 h-1 rounded-full bg-line/60"><div className="h-1 rounded-full bg-accent" style={{ width: `${(100 * v) / max}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] leading-relaxed text-ink-faint">{children}</p>;
}
