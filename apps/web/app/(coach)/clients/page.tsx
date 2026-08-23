import { getClients } from "@/lib/data";
import { Card, EmptyState, PageTitle, SignalBadge } from "@/components/ui";
import { pct, timeAgo } from "@/lib/format";
import { InviteButton } from "@/components/invite-button";

export default async function ClientsPage() {
  const clients = await getClients();
  return (
    <div>
      <PageTitle title="Clients">
        <InviteButton />
      </PageTitle>
      {clients.length === 0 ? (
        <EmptyState title="No clients yet" hint="Generate an invite code and share it — your client enters it in the app." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Signal</th>
                <th className="px-4 py-3">Adherence</th>
                <th className="px-4 py-3">Last activity</th>
                <th className="px-4 py-3">Since</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.client_id || c.started_at} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 font-semibold">{c.full_name}</td>
                  <td className="px-4 py-3 text-ink-soft">{c.status}</td>
                  <td className="px-4 py-3">
                    {c.status === "active" ? <SignalBadge signal={c.signal} /> : "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{c.status === "active" ? pct(c.overall_pct) : "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{timeAgo(c.last_activity)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    {c.started_at ? new Date(c.started_at).toLocaleDateString() : "—"}
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
