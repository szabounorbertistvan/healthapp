import { getClients, getProfile, isDemo } from "@/lib/data";
import { Card, EmptyState, PageTitle, SignalBadge } from "@/components/ui";
import { pct, timeAgo } from "@/lib/format";
import { InviteButton } from "@/components/invite-button";
import { AddClientButton } from "@/components/add-client-button";
import { entitlementsFor, TIER_LABEL } from "@/lib/entitlements";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

export default async function ClientsPage() {
  const { t, locale } = await getI18n();
  const [clients, profile] = await Promise.all([getClients(), getProfile()]);
  const maxClients = entitlementsFor(profile?.tier ?? "free").maxClients;
  const used = clients.length;
  const limitReached = used >= maxClients;

  return (
    <div>
      <PageTitle title={t.common.nav.clients}>
        <div className="flex items-center gap-3">
          <span className={`text-sm tabular-nums ${limitReached ? "font-semibold text-warn" : "text-ink-soft"}`}>
            {fill(t.coachApp.clients.slots, { used, max: maxClients })} · {TIER_LABEL[profile?.tier ?? "free"]}
          </span>
          {isDemo ? <AddClientButton disabled={limitReached} /> : null}
          <InviteButton disabled={limitReached} />
        </div>
      </PageTitle>
      {limitReached ? (
        <p className="mb-4 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {t.coachApp.clients.limitReached}
        </p>
      ) : null}
      {clients.length === 0 ? (
        <EmptyState title={t.coachApp.clients.emptyTitle} hint={t.coachApp.clients.emptyHint} />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                <th className="px-4 py-3">{t.coachApp.clients.thName}</th>
                <th className="px-4 py-3">{t.coachApp.clients.thStatus}</th>
                <th className="px-4 py-3">{t.coachApp.clients.thSignal}</th>
                <th className="px-4 py-3">{t.coachApp.clients.thAdherence}</th>
                <th className="px-4 py-3">{t.coachApp.clients.thLoad}</th>
                <th className="px-4 py-3">{t.coachApp.clients.thLastActivity}</th>
                <th className="px-4 py-3">{t.coachApp.clients.thSince}</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.client_id || c.started_at} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 font-semibold">{c.full_name}</td>
                  <td className="px-4 py-3 text-ink-soft">{t.coachApp.clients.status[c.status] ?? c.status}</td>
                  <td className="px-4 py-3">
                    {c.status === "active" ? <SignalBadge signal={c.signal} /> : "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{c.status === "active" ? pct(c.overall_pct) : "—"}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {c.status === "active" && c.load_7d > 0 ? c.load_7d : <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{timeAgo(c.last_activity, locale)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    {c.started_at ? new Date(c.started_at).toLocaleDateString(locale) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
