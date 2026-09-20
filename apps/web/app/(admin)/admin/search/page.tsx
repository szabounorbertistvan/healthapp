import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { adminSearch } from "@/lib/admin/data";
import { searchOf, type Search } from "@/lib/admin/params";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { AdminHeader, Pill, SearchInput, Section, UserCell, fmtDate, fmtDateTime } from "@/components/admin/ui";

// Admin · global search. One RPC, seven capped arms, one statement.
export default async function AdminSearchPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const { t, locale } = await getI18n();
  const m = t.admin.search;
  const c = t.admin.common;
  const q = searchOf(await searchParams);
  const r = q && q.length >= 2 ? await adminSearch(q) : null;
  const groups = r ? [
    { key: "users", n: r.users.length }, { key: "invitations", n: r.invitations.length }, { key: "exercises", n: r.exercises.length },
    { key: "foods", n: r.foods.length }, { key: "challenges", n: r.challenges.length }, { key: "posts", n: r.posts.length }, { key: "audit", n: r.audit.length },
  ] : [];
  const nothing = r !== null && groups.every((g) => g.n === 0);

  return (
    <div>
      <AdminHeader title={m.title} />
      <form action="/admin/search" method="GET" className="mb-4 flex max-w-2xl items-center gap-2">
        <SearchInput value={q} placeholder={m.placeholder} />
        <button type="submit" className="inline-flex h-9 items-center rounded-xl bg-accent px-4 text-[12.5px] font-bold text-accent-fg hover:opacity-90">{c.search}</button>
      </form>
      {r === null ? <p className="text-[13px] text-ink-faint">{m.hint}</p> : nothing ? <p className="text-[13px] text-ink-soft">{fill(m.empty, { q: q ?? "" })}</p> : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {r.users.length > 0 ? (
            <Section title={`${m.groups.users} · ${r.users.length}`}>
              <ul className="divide-y divide-line/60">
                {r.users.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-2 py-1.5">
                    <UserCell id={u.id} name={u.full_name} username={u.username} avatar={u.avatar_url} sub={u.email} />
                    <Pill tone={u.role === "admin" ? "accent" : "neutral"}>{c.roles[u.role as keyof typeof c.roles] ?? u.role}</Pill>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {r.invitations.length > 0 ? (
            <Section title={`${m.groups.invitations} · ${r.invitations.length}`}>
              <ul className="divide-y divide-line/60 text-[13px]">
                {r.invitations.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 py-1.5">
                    <Link href={`/admin/invitations?q=${i.id}`} className="min-w-0 truncate hover:text-accent-ink">@{i.coach_username ?? "?"} → {i.client_username ? `@${i.client_username}` : t.admin.invitations.noRecipient} · <span className="font-mono text-[11px] text-ink-faint">{i.id.slice(0, 8)}</span></Link>
                    <span className="flex shrink-0 items-center gap-2"><Pill>{i.status}</Pill><span className="text-[11.5px] text-ink-faint">{fmtDate(i.created_at, locale)}</span></span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {r.exercises.length > 0 ? (
            <Section title={`${m.groups.exercises} · ${r.exercises.length}`}>
              <ul className="divide-y divide-line/60 text-[13px]">
                {r.exercises.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 py-1.5">
                    <Link href={`/admin/exercises?q=${encodeURIComponent(e.name_en)}`} className="min-w-0 truncate hover:text-accent-ink"><span className="font-semibold">{e.name_en}</span>{e.name_ro ? <span className="text-ink-soft"> · {e.name_ro}</span> : null}</Link>
                    <span className="flex shrink-0 items-center gap-2 text-[11.5px] text-ink-faint">{e.category}<Pill>{e.source}</Pill></span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {r.foods.length > 0 ? (
            <Section title={`${m.groups.foods} · ${r.foods.length}`}>
              <ul className="divide-y divide-line/60 text-[13px]">
                {r.foods.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 py-1.5">
                    <Link href={`/admin/foods?q=${encodeURIComponent(f.name ?? "")}&all=1`} className="min-w-0 truncate hover:text-accent-ink"><span className="font-semibold">{f.name}</span>{f.brand ? <span className="text-ink-soft"> · {f.brand}</span> : null}</Link>
                    <span className="flex shrink-0 items-center gap-2 text-[11.5px] text-ink-faint">{f.barcode ? <span className="font-mono">{f.barcode}</span> : null}<Pill>{f.source}</Pill></span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {r.challenges.length > 0 ? (
            <Section title={`${m.groups.challenges} · ${r.challenges.length}`}>
              <ul className="divide-y divide-line/60 text-[13px]">
                {r.challenges.map((ch) => (
                  <li key={ch.id} className="flex items-center justify-between gap-2 py-1.5">
                    <Link href={`/admin/challenges/${ch.id}`} className="min-w-0 truncate font-semibold hover:text-accent-ink">{locale === "ro" ? ch.title_ro : ch.title_en}</Link>
                    <span className="shrink-0 text-[11.5px] text-ink-faint">{fmtDate(ch.start_date, locale)} → {fmtDate(ch.end_date, locale)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {r.posts.length > 0 ? (
            <Section title={`${m.groups.posts} · ${r.posts.length}`}>
              <ul className="divide-y divide-line/60 text-[13px]">
                {r.posts.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
                    <Link href={`/admin/social/${p.id}`} className="min-w-0 truncate hover:text-accent-ink"><span className="font-semibold">@{p.username ?? "?"}</span> · {p.text || p.type}</Link>
                    <span className="flex shrink-0 items-center gap-2 text-[11.5px] text-ink-faint">{p.deleted ? <Pill tone="risk">{m.deleted}</Pill> : null}{fmtDate(p.created_at, locale)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {r.audit.length > 0 ? (
            <Section title={`${m.groups.audit} · ${r.audit.length}`}>
              <ul className="divide-y divide-line/60 text-[13px]">
                {r.audit.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 py-1.5">
                    <Link href={`/admin/activity?q=${encodeURIComponent(a.entity_id ?? String(a.id))}`} className="min-w-0 truncate hover:text-accent-ink">
                      <Pill>{t.admin.activity.actions[a.action as keyof typeof t.admin.activity.actions] ?? a.action}</Pill>
                      <span className="ml-2 text-ink-soft">{a.actor_username ? `@${a.actor_username}` : c.system} · {a.entity_type} <span className="font-mono text-[11px] text-ink-faint">{a.entity_id?.slice(0, 8)}</span></span>
                    </Link>
                    <span className="shrink-0 text-[11.5px] text-ink-faint">{fmtDateTime(a.created_at, locale)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      )}
    </div>
  );
}
