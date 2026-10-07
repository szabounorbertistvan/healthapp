import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import type { RankRow } from "@/lib/admin/marketplace-data";
import { Pill, Table, Td, Th } from "./ui";

/**
 * coach_ranked()'s parts, row by row (20261110130000): admins only — the
 * public search returns the order and never a number. The raw signals sit
 * behind each row for "why is this coach here?".
 */
export async function RankingTable({ rows }: { rows: RankRow[] }) {
  const { t } = await getI18n();
  const m = t.admin.marketplace;
  const k = m.rk;
  const n = (v: number | string | null) => (v === null ? "—" : Number(v).toFixed(3));
  return (
    <Table empty={null} head={<>
      <Th>{k.pos}</Th><Th>{k.coach}</Th><Th>{k.relevance}</Th><Th>{k.trust}</Th><Th>{k.quality}</Th>
      <Th>{k.responsiveness}</Th><Th>{k.activity}</Th><Th>{k.engagement}</Th><Th>{k.cold}</Th><Th>{k.score}</Th>
    </>}>
      {rows.map((r) => (
        <tr key={r.profile_id} className="align-top tabular-nums" data-testid="admin-rank-row">
          <Td nowrap>{r.ord}</Td>
          <Td className="min-w-[180px]">
            <Link href={`/admin/coaches/${r.profile_id}`} className="font-semibold hover:underline">{r.display_name}</Link>
            {r.verified ? <span className="ml-1.5"><Pill tone="accent">✓</Pill></span> : null}
            <span className="block text-[11.5px] text-ink-faint">/coaches/{r.slug}</span>
            {r.signals ? (
              <details className="mt-1 text-[11.5px] text-ink-faint">
                <summary className="cursor-pointer">{m.signals}</summary>
                <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px]">{JSON.stringify(r.signals, null, 1)}</pre>
              </details>
            ) : null}
          </Td>
          <Td>{n(r.relevance)}</Td><Td>{n(r.trust)}</Td><Td>{n(r.quality)}</Td><Td>{n(r.responsiveness)}</Td>
          <Td>{n(r.activity)}</Td><Td>{n(r.engagement)}</Td><Td>{n(r.cold_start)}</Td>
          <Td className="font-bold">{n(r.score)}</Td>
        </tr>
      ))}
    </Table>
  );
}
