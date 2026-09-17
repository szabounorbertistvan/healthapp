import Link from "next/link";
import { getCheckIns, getDashboard } from "@/lib/data";
import { Card, SignalBadge, EmptyState } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { pct, timeAgo } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

/**
 * The coach's morning screen: four headline figures across the top, then the
 * queue of clients with why each one is flagged. Same shape as the client
 * Progress dashboard — centred stat tiles, then the list.
 */
export default async function DashboardPage() {
  const { t, locale } = await getI18n();
  const [rows, checkIns] = await Promise.all([getDashboard(), getCheckIns()]);
  const atRisk = rows.filter((r) => r.signal === "at_risk").length;
  const unread = rows.reduce((sum, r) => sum + r.unread_messages, 0);

  return (
    <div className="mx-auto max-w-[1600px]">
      <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
        {t.coachApp.dashboard.title}
      </h1>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:mt-6 sm:gap-4 lg:grid-cols-4">
        {/* Each tile opens the section it counts: the figure is the summary,
            the section is where the work happens. */}
        <Stat href="/clients" icon={ICON.clients} label={t.coachApp.dashboard.activeClients} value={rows.length} />
        <Stat
          href="/check-ins"
          icon={ICON.checkIns}
          label={t.coachApp.dashboard.checkInsToReview}
          value={checkIns.length}
          accent={checkIns.length > 0}
        />
        <Stat href="/messages" icon={ICON.messages} label={t.coachApp.dashboard.unreadMessages} value={unread} accent={unread > 0} />
        <Stat href="/clients" icon={ICON.risk} label={t.coachApp.dashboard.atRisk} value={atRisk} accent={atRisk > 0} />
      </div>

      <div className="mt-4 space-y-4 sm:mt-6 sm:space-y-5">
        {rows.length === 0 ? (
          <EmptyState plain title={t.coachApp.dashboard.emptyTitle} hint={t.coachApp.dashboard.emptyHint} />
        ) : (
          <>
            {/* The desk is a table once there is room for six columns. */}
            <Card plain className="hidden overflow-hidden p-0 sm:block">
              <div className="overflow-x-auto">
                <table className="w-full text-[13.5px]">
                  <thead>
                    <tr className="whitespace-nowrap text-left text-[11px] uppercase tracking-wider text-ink-faint">
                      <th className="px-6 pb-2 pt-[18px] font-semibold">{t.coachApp.dashboard.thClient}</th>
                      <th className="px-3 pb-2 pt-[18px] font-semibold">{t.coachApp.dashboard.thSignal}</th>
                      <th className="px-3 pb-2 pt-[18px] font-semibold">{t.coachApp.dashboard.thWhy}</th>
                      <th className="px-3 pb-2 pt-[18px] text-right font-semibold">{t.coachApp.dashboard.thAdherence}</th>
                      <th className="px-3 pb-2 pt-[18px] font-semibold">{t.coachApp.dashboard.thLastLog}</th>
                      <th className="px-6 pb-2 pt-[18px]" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {rows.map((r) => (
                      <tr key={r.client_id} className="align-middle">
                        <td className="whitespace-nowrap py-4 pl-6 pr-3">
                          <span className="flex items-center gap-3">
                            <Avatar name={r.full_name} />
                            <span className="text-[15px] font-semibold">{r.full_name}</span>
                          </span>
                        </td>
                        <td className="px-3 py-4"><SignalBadge signal={r.signal} /></td>
                        <td className="min-w-56 px-3 py-4 text-[13px] leading-relaxed text-ink-soft">{r.reason}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-right">
                          <Adherence value={r.overall_pct} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-[13px] tabular-nums text-ink-faint">
                          {timeAgo(r.last_activity, locale)}
                        </td>
                        <td className="py-4 pl-3 pr-6 text-right">
                          <RowAction
                            href={r.pending_checkin ? "/check-ins" : `/clients?focus=${r.client_id}`}
                            label={r.pending_checkin ? t.coachApp.dashboard.review : t.coachApp.dashboard.open}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Phone: the same six columns as rows.
                The table above is `overflow-x-auto`, which on a 375px screen showed
                client / signal / reason and hid adherence, last log and the action
                link off the right edge — the three things that decide whether you
                need to open the client at all. Nothing is dropped here; it is the
                same row, stacked. */}
            <Card plain className="overflow-hidden p-0 sm:hidden">
              <ul className="divide-y divide-line/60">
                {rows.map((r) => (
                  <li key={r.client_id} className="px-5 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 flex-1 items-center gap-3">
                        <Avatar name={r.full_name} />
                        <span className="truncate text-[15px] font-semibold">{r.full_name}</span>
                      </span>
                      <SignalBadge signal={r.signal} />
                    </div>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{r.reason}</p>
                    <dl className="mt-3 flex items-end justify-between gap-3">
                      <div>
                        <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                          {t.coachApp.dashboard.thAdherence}
                        </dt>
                        <dd className="mt-1">
                          <Adherence value={r.overall_pct} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                          {t.coachApp.dashboard.thLastLog}
                        </dt>
                        <dd className="mt-0.5 text-[13px] tabular-nums text-ink-soft">
                          {timeAgo(r.last_activity, locale)}
                        </dd>
                      </div>
                      <RowAction
                        href={r.pending_checkin ? "/check-ins" : `/clients?focus=${r.client_id}`}
                        label={r.pending_checkin ? t.coachApp.dashboard.review : t.coachApp.dashboard.open}
                      />
                    </dl>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

/** The 24-box icon paths this screen uses. */
const ICON = {
  clients:
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2 20a7 7 0 0 1 14 0M17 11a3 3 0 0 0 0-6M18 20h4a6 6 0 0 0-3-5.2",
  checkIns: "M9 4h6v3H9zM9 5.5H6V20h12V5.5h-3M8.5 13l2.5 2.5 4.5-4.5",
  messages: "M4 5h16v11H9l-5 4z",
  risk: "M12 3.5 2.5 20.5h19zM12 10v4M12 17v.01",
  chevron: "m9 6 6 6-6 6",
} as const;

/** The client's initial, so a queue row has something to aim at. */
function Avatar({ name }: { name: string }) {
  // Only a real name gets a letter: an invitation placeholder starts with a bracket.
  const first = [...name.trim()][0] ?? "";
  const initial = /\p{L}/u.test(first) ? first : null;
  return (
    <span
      aria-hidden
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft font-display text-sm font-bold text-accent-ink"
    >
      {initial ? initial.toUpperCase() : <NavIcon d="M12 4a4 4 0 1 0 0 8 4 4 0 1 0 0-8M4 21a8 8 0 0 1 16 0" className="h-[17px] w-[17px]" />}
    </span>
  );
}

/** Weekly adherence: the figure with a short meter under it, so a row reads at a glance. */
function Adherence({ value }: { value: number }) {
  const width = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <span className="inline-flex w-20 flex-col items-end gap-1.5">
      <span className="font-display text-[17px] font-extrabold tabular-nums leading-none">{pct(value)}</span>
      <span className="h-1 w-full overflow-hidden rounded-full bg-bg">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
      </span>
    </span>
  );
}

/** The row's one action — "Review" or "Open", a pill that keeps a 44px target. */
function RowAction({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-bg px-4 text-[12.5px] font-semibold text-accent-ink hover:opacity-80 sm:h-9"
    >
      {label}
      <NavIcon d={ICON.chevron} className="h-3.5 w-3.5 [stroke-width:2.2]" />
    </Link>
  );
}

/** One headline figure on its own tile: an icon, the label, the number — and a link to the section behind it. */
function Stat({
  href,
  icon,
  label,
  value,
  accent = false,
}: {
  href: string;
  icon: string;
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-2.5 rounded-3xl bg-surface px-4 py-5 text-center transition hover:bg-accent-soft/40 sm:gap-3 sm:py-6"
    >
      <NavIcon d={icon} className="h-10 w-10 shrink-0 text-accent-ink sm:h-12 sm:w-12" />
      <p className="flex min-h-[2.4em] w-full items-center justify-center text-[11px] font-semibold uppercase leading-snug tracking-wider text-ink-faint">
        {label}
      </p>
      <p
        className={`font-display text-[32px] font-extrabold tabular-nums leading-none sm:text-[40px] ${
          accent ? "text-accent-ink" : ""
        }`}
      >
        {value}
      </p>
    </Link>
  );
}
