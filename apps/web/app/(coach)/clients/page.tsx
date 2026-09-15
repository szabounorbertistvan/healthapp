import Link from "next/link";
import { getClients, getProfile } from "@/lib/data";
import { Card, EmptyState, SignalBadge } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { pct, timeAgo } from "@/lib/format";
import { InviteButton } from "@/components/invite-button";
import { entitlementsFor, TIER_LABEL } from "@/lib/entitlements";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

/** The 24-box icon paths this screen uses. */
const ICON = {
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4",
} as const;

export default async function ClientsPage() {
  const { t, locale } = await getI18n();
  const [clients, profile] = await Promise.all([getClients(), getProfile()]);
  const maxClients = entitlementsFor(profile?.tier ?? "free").maxClients;
  const used = clients.length;
  const limitReached = used >= maxClients;

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
          {t.common.nav.clients}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex h-9 items-center rounded-full bg-surface px-3.5 text-[12.5px] font-semibold tabular-nums ${
              limitReached ? "text-warn" : "text-ink-soft"
            }`}
          >
            {fill(t.coachApp.clients.slots, { used, max: maxClients })} · {TIER_LABEL[profile?.tier ?? "free"]}
          </span>
          <Link
            href="/clients/challenges"
            className="inline-flex h-9 items-center gap-2 rounded-full bg-surface px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
          >
            <NavIcon d={ICON.trophy} className="h-[17px] w-[17px]" />
            {t.common.challenges.coachTitle}
          </Link>
          <InviteButton disabled={limitReached} />
        </div>
      </div>

      {limitReached ? (
        <p className="mt-4 rounded-2xl bg-warn-soft px-5 py-3.5 text-[13px] leading-relaxed text-warn">
          {t.coachApp.clients.limitReached}
        </p>
      ) : null}

      <div className="mt-4 sm:mt-6">
        {clients.length === 0 ? (
          <EmptyState plain title={t.coachApp.clients.emptyTitle} hint={t.coachApp.clients.emptyHint} />
        ) : (
          <>
            {/* The roster stays a table where there is room for seven columns. */}
            <Card plain className="hidden overflow-hidden p-0 sm:block">
              <div className="overflow-x-auto">
                <table className="w-full text-[13.5px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-ink-faint">
                      <th className="px-6 pb-2 pt-[18px] font-semibold">{t.coachApp.clients.thName}</th>
                      <th className="px-3 pb-2 pt-[18px] font-semibold">{t.coachApp.clients.thStatus}</th>
                      <th className="px-3 pb-2 pt-[18px] font-semibold">{t.coachApp.clients.thSignal}</th>
                      <th className="px-3 pb-2 pt-[18px] text-right font-semibold">{t.coachApp.clients.thAdherence}</th>
                      <th className="px-3 pb-2 pt-[18px] text-right font-semibold">{t.coachApp.clients.thLoad}</th>
                      <th className="px-3 pb-2 pt-[18px] font-semibold">{t.coachApp.clients.thLastActivity}</th>
                      <th className="px-6 pb-2 pt-[18px] font-semibold">{t.coachApp.clients.thSince}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {clients.map((c) => (
                      <tr key={c.client_id || c.started_at} className="align-middle">
                        <td className="whitespace-nowrap py-4 pl-6 pr-3">
                          <span className="flex items-center gap-3">
                            <Avatar name={c.full_name} muted={c.status !== "active"} />
                            <span className="text-[15px] font-semibold">
                              {c.status === "active" && c.client_id ? (
                                <Link href={`/clients/${c.client_id}`} className="hover:text-accent-ink">
                                  {c.full_name}
                                </Link>
                              ) : (
                                c.full_name
                              )}
                            </span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-[13px] text-ink-soft">
                          {t.coachApp.clients.status[c.status] ?? c.status}
                        </td>
                        <td className="px-3 py-4">
                          {c.status === "active" ? <SignalBadge signal={c.signal} /> : <span className="text-ink-faint">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-right">
                          {c.status === "active" ? (
                            <Adherence value={c.overall_pct} />
                          ) : (
                            <span className="text-ink-faint">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-right font-display text-[17px] font-extrabold tabular-nums">
                          {c.status === "active" && c.load_7d > 0 ? c.load_7d : <span className="font-sans text-sm font-normal text-ink-faint">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-[13px] tabular-nums text-ink-faint">
                          {timeAgo(c.last_activity, locale)}
                        </td>
                        <td className="whitespace-nowrap py-4 pl-3 pr-6 text-[13px] tabular-nums text-ink-faint">
                          {c.started_at ? new Date(c.started_at).toLocaleDateString(locale) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Phone: the same seven columns as divided rows. Seven columns need
                far more than 390px, and a sideways-scrolling roster hides the
                numbers you scan it for. Nothing is dropped — the row is stacked. */}
            <Card plain className="overflow-hidden p-0 sm:hidden">
              <ul className="divide-y divide-line/60">
                {clients.map((c) => (
                  <li key={c.client_id || c.started_at} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <Avatar name={c.full_name} muted={c.status !== "active"} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold">
                          {c.status === "active" && c.client_id ? (
                            <Link href={`/clients/${c.client_id}`} className="hover:text-accent-ink">
                              {c.full_name}
                            </Link>
                          ) : (
                            c.full_name
                          )}
                        </p>
                        <p className="mt-0.5 text-[12.5px] text-ink-faint">
                          {t.coachApp.clients.status[c.status] ?? c.status} ·{" "}
                          <span className="tabular-nums">
                            {c.started_at ? new Date(c.started_at).toLocaleDateString(locale) : "—"}
                          </span>
                        </p>
                      </div>
                      {c.status === "active" ? <SignalBadge signal={c.signal} /> : null}
                    </div>
                    <dl className="mt-3 flex items-end justify-between gap-3">
                      <div>
                        <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                          {t.coachApp.clients.thAdherence}
                        </dt>
                        <dd className="mt-0.5 font-display text-[19px] font-extrabold tabular-nums leading-none">
                          {c.status === "active" ? pct(c.overall_pct) : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                          {t.coachApp.clients.thLoad}
                        </dt>
                        <dd className="mt-0.5 font-display text-[19px] font-extrabold tabular-nums leading-none">
                          {c.status === "active" && c.load_7d > 0 ? c.load_7d : <span className="text-ink-faint">—</span>}
                        </dd>
                      </div>
                      <div className="text-right">
                        <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                          {t.coachApp.clients.thLastActivity}
                        </dt>
                        <dd className="mt-0.5 text-[13px] tabular-nums text-ink-soft">
                          {timeAgo(c.last_activity, locale)}
                        </dd>
                      </div>
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

/**
 * The client's initial, so a roster row has something to aim at. A row that is
 * still an invitation has no name yet — its placeholder starts with a bracket —
 * so it gets an envelope instead of a punctuation mark.
 */
function Avatar({ name, muted = false }: { name: string; muted?: boolean }) {
  // Only a real name gets a letter: an invitation placeholder starts with a bracket.
  const first = [...name.trim()][0] ?? "";
  const initial = /\p{L}/u.test(first) ? first : null;
  return (
    <span
      aria-hidden
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-sm font-bold ${
        muted ? "bg-bg text-ink-faint" : "bg-accent-soft text-accent-ink"
      }`}
    >
      {initial ? (
        initial.toUpperCase()
      ) : (
        <NavIcon d="M3 6h18v12H3zM3 7l9 6 9-6" className="h-[17px] w-[17px]" />
      )}
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
