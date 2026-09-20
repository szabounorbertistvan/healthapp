import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { getAdminSocialPost } from "@/lib/admin/data";
import { uuidOf } from "@/lib/admin/params";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { AdminHeader, Facts, Pill, Section, Table, Td, Th, UserCell, fmtDateTime } from "@/components/admin/ui";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { deletePostAsAdmin } from "@/app/admin-actions";

// Admin · one post, with its snapshot payload, comments and kudos.
export default async function AdminPostPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { t, locale } = await getI18n();
  const m = t.admin.social;
  const c = t.admin.common;
  const id = uuidOf((await params).id);
  const p = id ? await getAdminSocialPost(id) : null;
  if (!p) return <p className="text-sm text-ink-soft">{m.post.notFound}</p>;

  return (
    <div>
      <AdminHeader title={`${m.post.title} · ${m.types[p.type as keyof typeof m.types] ?? p.type}`}>
        <Link href={`/feed/${p.id}`} className="inline-flex h-9 items-center rounded-xl bg-surface px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink">/feed</Link>
        {!p.deleted_at
          ? <ConfirmAction label={m.delete} title={m.deleteTitle} body={m.deleteBody} tone="risk" withReason action={deletePostAsAdmin.bind(null, p.id)} />
          : <Pill tone="risk">{fill(m.post.deletedAt, { when: fmtDateTime(p.deleted_at, locale) })}</Pill>}
      </AdminHeader>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title={m.post.title}>
          <div className="mb-3"><UserCell id={p.author.id} name={p.author.full_name} username={p.author.username} avatar={p.author.avatar_url} /></div>
          {p.text ? <p className="mb-3 whitespace-pre-wrap text-[14px] leading-relaxed">{p.text}</p> : null}
          <Facts items={[
            { label: c.id, value: p.id, mono: true },
            { label: m.th.created, value: fmtDateTime(p.created_at, locale) },
            { label: m.th.visibility, value: m.visibilities[p.visibility as keyof typeof m.visibilities] ?? p.visibility },
            { label: m.th.status, value: p.deleted_at ? m.statuses.deleted : m.statuses.live },
            ...(p.activity_id ? [{ label: "session", value: p.activity_id, mono: true }] : []),
            ...(p.challenge_id ? [{ label: "challenge", value: <Link href={`/admin/challenges/${p.challenge_id}`} className="font-mono text-[12px] hover:text-accent-ink">{p.challenge_id}</Link> }] : []),
          ]} />
        </Section>
        <Section title={m.post.payload}>
          {p.payload ? <pre className="max-h-80 overflow-auto rounded-xl bg-bg p-3 text-[11.5px] leading-relaxed text-ink-soft">{JSON.stringify(p.payload, null, 2)}</pre> : <p className="text-[13px] text-ink-faint">{c.none}</p>}
        </Section>
        <Section title={`${m.post.comments} · ${p.comments.length}`}>
          <Table empty={p.comments.length === 0 ? m.post.noComments : null} head={<><Th>{m.th.author}</Th><Th>{m.th.text}</Th><Th>{m.th.created}</Th></>}>
            {p.comments.map((cm) => (
              <tr key={cm.id}>
                <Td nowrap><Link href={`/admin/users/${cm.user_id}`} className="hover:text-accent-ink">@{cm.username ?? cm.user_id.slice(0, 8)}</Link></Td>
                <Td>{cm.body}</Td>
                <Td nowrap className="text-ink-soft">{fmtDateTime(cm.created_at, locale)}</Td>
              </tr>
            ))}
          </Table>
        </Section>
        <Section title={`${m.post.kudos} · ${p.kudos.length}`}>
          {p.kudos.length === 0 ? <p className="text-[13px] text-ink-faint">{m.post.noKudos}</p> : (
            <ul className="flex flex-wrap gap-1.5">
              {p.kudos.map((k) => <li key={k.user_id}><Link href={`/admin/users/${k.user_id}`}><Pill>@{k.username ?? k.user_id.slice(0, 8)}</Pill></Link></li>)}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
