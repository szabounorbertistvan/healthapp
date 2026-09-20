import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { getAdminUserDetail, getAdminUserFitness, getAdminUserTimeline } from "@/lib/admin/data";
import { str, uuidOf, type Search } from "@/lib/admin/params";
import { getUserStreak } from "@/lib/streak-data";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { TIER_LABEL } from "@/lib/entitlements";
import type { Tier } from "@/lib/entitlements";
import { AdminTierSelect } from "@/components/billing";
import { Avatar } from "@/components/social";
import { FitnessScoreCoachCard } from "@/components/fitness-score";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { Timeline } from "@/components/admin/timeline";
import { WeightLine } from "@/components/admin/charts";
import { Breakdown, Facts, Kpi, KpiGrid, Note, Pill, Section, Table, Td, Th, UserCell, fmtDate, fmtDateTime, fmtNum } from "@/components/admin/ui";
import { reactivateUser, removePushSubscription, suspendUser } from "@/app/admin-actions";

const TIMELINE_PAGE = 60;

// Admin · one user. Two RPC waves: the detail document plus the fitness
// sessions and streak in one, then the timeline page. `before` in the URL
// pages the timeline backwards.
export default async function AdminUserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const me = await requireAdmin();
  const { t, locale } = await getI18n();
  const m = t.admin.user;
  const c = t.admin.common;
  const id = uuidOf((await params).id);
  const before = str(await searchParams, "before");

  if (!id) return <p className="text-sm text-ink-soft">{m.notFound}</p>;
  const [d, timeline] = await Promise.all([
    getAdminUserDetail(id),
    getAdminUserTimeline(id, before && !Number.isNaN(Date.parse(before)) ? before : null, TIMELINE_PAGE),
  ]);
  if (!d) return <p className="text-sm text-ink-soft">{m.notFound}</p>;
  const [fitness, streak] = await Promise.all([getAdminUserFitness(id, d.profile.timezone), getUserStreak(id)]);

  const p = d.profile;
  const a = d.account;
  const name = p.username ? `@${p.username}` : p.full_name ?? c.unknownUser;
  const n = (v: number | null | undefined) => fmtNum(v, locale);
  const dt = (v: string | null | undefined) => fmtDateTime(v, locale);
  const dd = (v: string | null | undefined) => fmtDate(v, locale);
  const lastActivity = [d.activity.last_workout_at, d.nutrition.last_food_log_at, d.social.recent_posts[0]?.created_at]
    .filter((x): x is string => Boolean(x)).sort().pop() ?? null;
  const moreHref = timeline.length === TIMELINE_PAGE ? `/admin/users/${id}?before=${encodeURIComponent(timeline[timeline.length - 1].occurred_at)}#timeline` : null;
  const weightChange = d.progress.latest_weight && d.progress.first_weight
    ? Number(d.progress.latest_weight.kg) - Number(d.progress.first_weight.kg) : null;

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-center gap-4">
        <Avatar name={p.full_name ?? name} url={p.avatar_url} size="h-14 w-14" />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-extrabold tracking-tight">{name}</h1>
          <p className="truncate text-[13px] text-ink-soft">
            {p.full_name}{a?.email ? ` · ${a.email}` : ""}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Pill tone={p.role === "admin" ? "accent" : "neutral"}>{c.roles[p.role as keyof typeof c.roles] ?? p.role}</Pill>
            {p.suspended_at ? <Pill tone="risk">{m.account.statusSuspended}</Pill> : a?.deletion ? <Pill tone="warn">{m.account.statusDeleting}</Pill> : <Pill tone="accent">{m.account.statusActive}</Pill>}
            <Pill>{TIER_LABEL[(a?.tier ?? "free") as Tier] ?? a?.tier}</Pill>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/people/${p.id}`} className="inline-flex h-9 items-center rounded-xl bg-surface px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink">{m.actions.viewSocial}</Link>
          {p.role === "admin" ? <Note>{m.actions.cannotSuspendAdmin}</Note>
            : p.id === me.id ? <Note>{m.actions.cannotSuspendSelf}</Note>
            : p.suspended_at
              ? <ConfirmAction label={m.actions.reactivate} title={m.actions.reactivateTitle} body={m.actions.reactivateBody} tone="accent" action={reactivateUser.bind(null, p.id)} />
              : <ConfirmAction label={m.actions.suspend} title={m.actions.suspendTitle} body={m.actions.suspendBody} tone="risk" withReason action={suspendUser.bind(null, p.id)} />}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title={m.sections.profile}>
              <Facts items={[
                { label: m.profile.id, value: p.id, mono: true },
                { label: m.profile.name, value: p.full_name },
                { label: m.profile.username, value: p.username },
                { label: m.profile.email, value: a?.email ?? c.none },
                { label: m.profile.role, value: c.roles[p.role as keyof typeof c.roles] ?? p.role },
                { label: m.profile.timezone, value: p.timezone },
                { label: m.profile.locale, value: p.locale },
                { label: m.profile.units, value: `${p.weight_unit} · ${p.length_unit}` },
                { label: m.profile.sex, value: p.sex ?? c.none },
                { label: m.profile.birthYear, value: p.birth_year ?? c.none },
                { label: m.profile.city, value: p.city ?? c.none },
                { label: m.profile.checkInDay, value: p.check_in_weekday },
                { label: m.profile.leaderboard, value: p.leaderboard_visibility },
                { label: m.profile.created, value: dt(p.created_at) },
                { label: m.profile.updated, value: dt(p.updated_at) },
                { label: m.profile.lastActivity, value: lastActivity ? dt(lastActivity) : c.never },
                { label: m.profile.lastLogin, value: a?.last_sign_in_at ? dt(a.last_sign_in_at) : c.never },
              ]} />
              {p.bio ? <p className="mt-3 text-[13px] text-ink-soft"><span className="text-ink-faint">{m.profile.bio}: </span>{p.bio}</p> : null}
            </Section>

            <Section title={m.sections.account}>
              <Facts items={[
                { label: m.account.authCreated, value: dt(a?.auth_created_at) },
                { label: m.account.confirmed, value: a?.email_confirmed_at ? dt(a.email_confirmed_at) : m.account.notConfirmed },
                { label: m.account.provider, value: a?.primary_provider ?? c.none },
                { label: m.account.providers, value: a?.providers?.join(", ") || c.none },
                { label: m.account.tier, value: `${TIER_LABEL[(a?.tier ?? "free") as Tier] ?? a?.tier}${a?.tier_status ? ` (${a.tier_status})` : ""}` },
                { label: m.account.tierProvider, value: a?.tier_provider ?? c.none },
                { label: m.account.invitedBy, value: a?.invited_by ? <Link href={`/admin/users/${a.invited_by.id}`} className="hover:text-accent-ink">@{a.invited_by.username ?? a.invited_by.full_name}</Link> : c.none },
                { label: m.account.deletion, value: a?.deletion ? dt(a.deletion.requested_at) : c.no },
                ...(a?.deletion ? [{ label: m.account.purgeAfter, value: dt(a.deletion.purge_after) }] : []),
                ...(p.suspended_at ? [{ label: m.account.suspended, value: dt(p.suspended_at) }, { label: m.account.suspendedReason, value: p.suspended_reason ?? c.none }] : []),
              ]} />
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className="text-[12px] text-ink-faint">{m.actions.tier}</span>
                <AdminTierSelect userId={p.id} tier={(a?.tier ?? "free") as Tier} />
                <Note>{m.actions.tierHint}</Note>
              </div>
              <Note>{m.actions.noDeleteHint}</Note>
            </Section>
          </div>

          <Section title={m.sections.activity}>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div>
                <KpiGrid cols={4}>
                  <Kpi label={m.activity.workouts} value={n(d.activity.workouts)} accent sub={`${n(d.activity.workouts_7d)} · ${c.last7} · ${n(d.activity.workouts_30d)} · ${c.last30}`} />
                  <Kpi label={m.activity.sets} value={n(d.activity.sets)} sub={`${n(d.activity.sets_7d)} · ${c.last7}`} />
                  <Kpi label={m.activity.streak} value={fill(m.activity.streakDays, { n: streak.current })} sub={fill(m.activity.longest, { n: streak.longest })} />
                  <Kpi label={m.activity.prs} value={n(d.activity.prs)} />
                  <Kpi label={m.activity.abandoned} value={n(d.activity.abandoned)} warn={d.activity.abandoned > 0} />
                  <Kpi label={m.activity.avgDuration} value={d.activity.avg_duration_min ? `${n(d.activity.avg_duration_min)} ${c.min}` : c.none} />
                  <Kpi label={m.activity.exercises} value={n(d.activity.exercises_used)} />
                  <Kpi label={m.activity.programs} value={n(d.activity.programs)} sub={`${n(d.activity.programs_published)} ${m.activity.programsPublished.toLowerCase()}`} />
                  <Kpi label={m.activity.habits} value={n(d.activity.habits_active)} sub={`${n(d.activity.habit_logs_30d)} · ${m.activity.habitLogs30d.toLowerCase()}`} />
                  <Kpi label={m.activity.first} value={<span className="text-[14px]">{dd(d.activity.first_workout_at)}</span>} />
                  <Kpi label={m.activity.last} value={<span className="text-[14px]">{dd(d.activity.last_workout_at)}</span>} />
                  {p.role !== "client" ? <Kpi label={m.activity.programsBuilt} value={n(d.activity.programs_built)} /> : null}
                </KpiGrid>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.activity.topExercises}</h3>
                    <Breakdown data={Object.fromEntries(d.activity.top_exercises.map((x) => [x.name, x.sets]))} locale={locale} />
                  </div>
                  <div>
                    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.activity.challenges}</h3>
                    {d.activity.challenges.length === 0 ? <p className="text-[13px] text-ink-faint">{m.activity.noChallenges}</p> : (
                      <ul className="space-y-1.5 text-[12.5px]">
                        {d.activity.challenges.map((ch) => (
                          <li key={ch.id} className="flex items-center justify-between gap-2">
                            <Link href={`/admin/challenges/${ch.id}`} className="truncate hover:text-accent-ink">{ch.title}</Link>
                            {ch.completed_at ? <Pill tone="accent">{m.activity.completed}</Pill> : <Pill>{m.activity.joined} {dd(ch.joined_at)}</Pill>}
                          </li>
                        ))}
                      </ul>
                    )}
                    <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.activity.badges}</h3>
                    {d.activity.badges.length === 0 ? <p className="text-[13px] text-ink-faint">{m.activity.noBadges}</p> : (
                      <div className="flex flex-wrap gap-1.5">{d.activity.badges.map((b) => <Pill key={b.slug} tone="accent">{b.name}</Pill>)}</div>
                    )}
                  </div>
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.activity.fitness}</h3>
                <FitnessScoreCoachCard view={fitness} />
              </div>
            </div>
          </Section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title={m.sections.nutrition}>
              <KpiGrid cols={3}>
                <Kpi label={m.nutrition.logs} value={n(d.nutrition.food_logs)} accent sub={`${n(d.nutrition.food_logs_7d)} · ${c.last7}`} />
                <Kpi label={m.nutrition.daysLogged} value={n(d.nutrition.days_logged_30d)} />
                <Kpi label={m.nutrition.avgKcal} value={d.nutrition.avg_kcal_7d ? n(d.nutrition.avg_kcal_7d) : c.none} />
                <Kpi label={m.nutrition.plans} value={n(d.nutrition.plans)} />
                <Kpi label={m.nutrition.customFoods} value={n(d.nutrition.custom_foods)} />
                <Kpi label={m.nutrition.favorites} value={n(d.nutrition.favorites)} />
              </KpiGrid>
              <div className="mt-3">
                <Facts items={[
                  { label: m.nutrition.last, value: d.nutrition.last_food_log_at ? dt(d.nutrition.last_food_log_at) : c.never },
                  { label: m.nutrition.activePlan, value: d.nutrition.active_plan ? `${d.nutrition.active_plan.name} · ${fill(m.nutrition.targets, { kcal: d.nutrition.active_plan.kcal, p: d.nutrition.active_plan.protein_g, c: d.nutrition.active_plan.carbs_g, f: d.nutrition.active_plan.fat_g })} · ${fill(m.nutrition.meals, { n: d.nutrition.active_plan.meals })}` : m.nutrition.noPlan },
                  ...(p.role !== "client" ? [{ label: m.nutrition.plansBuilt, value: n(d.nutrition.plans_built) }] : []),
                ]} />
              </div>
              <h3 className="mb-2 mt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.nutrition.methods}</h3>
              <Breakdown data={d.nutrition.methods} labels={t.admin.nutrition.methods} locale={locale} />
            </Section>

            <Section title={m.sections.progress}>
              <KpiGrid cols={3}>
                <Kpi label={m.progress.latestWeight} value={d.progress.latest_weight ? `${d.progress.latest_weight.kg} ${c.kg}` : c.none} sub={d.progress.latest_weight ? dd(d.progress.latest_weight.date) : undefined} accent />
                <Kpi label={m.progress.change} value={weightChange === null ? c.none : `${weightChange > 0 ? "+" : ""}${weightChange.toFixed(1)} ${c.kg}`} sub={d.progress.first_weight ? `${m.progress.firstWeight}: ${d.progress.first_weight.kg} ${c.kg}` : undefined} />
                <Kpi label={m.progress.measurements} value={n(d.progress.measurements)} />
                <Kpi label={m.progress.checkIns} value={n(d.progress.check_ins)} />
                <Kpi label={m.progress.photos} value={n(d.progress.photos)} sub={d.progress.last_photo_at ? dd(d.progress.last_photo_at) : undefined} />
                <Kpi label={m.progress.goals} value={n(d.progress.goals)} />
              </KpiGrid>
              <div className="mt-3">
                {d.progress.weight_history.length >= 2 ? <WeightLine points={d.progress.weight_history} locale={locale} unit={c.kg} /> : <Note>{m.progress.noWeights}</Note>}
              </div>
              <div className="mt-3">
                <Facts items={[
                  { label: m.progress.lastCheckIn, value: d.progress.last_check_in ? `${dd(d.progress.last_check_in.week_start)} · ${d.progress.last_check_in.reviewed ? m.progress.reviewed : m.progress.notReviewed}` : c.none },
                  ...(d.progress.last_check_in ? [{ label: "", value: fill(m.progress.scales, { sleep: d.progress.last_check_in.sleep ?? "–", energy: d.progress.last_check_in.energy ?? "–", stress: d.progress.last_check_in.stress ?? "–", hunger: d.progress.last_check_in.hunger ?? "–", recovery: d.progress.last_check_in.recovery ?? "–" }) }] : []),
                  { label: m.progress.adherence, value: d.progress.latest_adherence ? `${dd(d.progress.latest_adherence.week_start)} · ${Math.round(Number(d.progress.latest_adherence.overall_pct) * 100)}% · ${d.progress.latest_adherence.signal}` : c.none },
                ]} />
              </div>
            </Section>

            <Section title={m.sections.social}>
              <KpiGrid cols={3}>
                <Kpi label={m.social.posts} value={n(d.social.posts)} accent sub={`${n(d.social.posts_deleted)} ${m.social.deleted.toLowerCase()}`} />
                <Kpi label={m.social.comments} value={n(d.social.comments)} />
                <Kpi label={m.social.kudosGiven} value={n(d.social.kudos_given)} />
                <Kpi label={m.social.kudosReceived} value={n(d.social.kudos_received)} />
                <Kpi label={m.social.followers} value={n(d.social.followers)} />
                <Kpi label={m.social.following} value={n(d.social.following)} />
              </KpiGrid>
              <h3 className="mb-2 mt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.social.recent}</h3>
              {d.social.recent_posts.length === 0 ? <p className="text-[13px] text-ink-faint">{m.social.noPosts}</p> : (
                <ul className="divide-y divide-line/60 text-[12.5px]">
                  {d.social.recent_posts.map((post) => (
                    <li key={post.id} className="flex items-center justify-between gap-3 py-1.5">
                      <Link href={`/admin/social/${post.id}`} className="min-w-0 truncate hover:text-accent-ink">
                        <span className="font-semibold">{t.admin.social.types[post.type as keyof typeof t.admin.social.types] ?? post.type}</span>
                        {post.text ? <span className="text-ink-soft"> · {post.text}</span> : null}
                      </Link>
                      <span className="shrink-0 whitespace-nowrap text-ink-faint">{post.deleted_at ? <Pill tone="risk">{t.admin.social.statuses.deleted}</Pill> : `${post.kudos} ♥ · ${post.comments} ✎`} · {dd(post.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={m.sections.coaching}>
              <Facts items={[
                { label: m.coaching.currentCoach, value: d.coaching.current_coach ? <Link href={`/admin/users/${d.coaching.current_coach.id}`} className="hover:text-accent-ink">@{d.coaching.current_coach.username ?? d.coaching.current_coach.full_name} · {fill(m.coaching.since, { date: dd(d.coaching.current_coach.since) })}</Link> : m.coaching.noCoach },
                { label: m.coaching.pastCoaches, value: d.coaching.past_coaches.length === 0 ? m.coaching.none : d.coaching.past_coaches.map((pc) => `@${pc.username ?? pc.full_name} (${dd(pc.from)} → ${dd(pc.to)})`).join(", ") },
              ]} />
              {p.role !== "client" ? (
                <>
                  <h3 className="mb-2 mt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.coaching.clients} · {d.coaching.clients.length}</h3>
                  {d.coaching.clients.length === 0 ? <p className="text-[13px] text-ink-faint">{m.coaching.noClients}</p> : (
                    <ul className="space-y-1.5">
                      {d.coaching.clients.map((cl) => (
                        <li key={cl.id} className="flex items-center justify-between gap-2">
                          <UserCell id={cl.id} name={cl.full_name} username={cl.username} avatar={cl.avatar_url} />
                          <Pill tone={cl.status === "active" ? "accent" : "neutral"}>{cl.status}</Pill>
                        </li>
                      ))}
                    </ul>
                  )}
                  <h3 className="mb-2 mt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.coaching.invitationsSent} · {d.coaching.invitations_sent.length}</h3>
                  {d.coaching.invitations_sent.length === 0 ? <p className="text-[13px] text-ink-faint">{m.coaching.none}</p> : (
                    <ul className="space-y-1 text-[12.5px]">
                      {d.coaching.invitations_sent.slice(0, 10).map((inv) => (
                        <li key={inv.id} className="flex items-center justify-between gap-2">
                          <span className="truncate text-ink-soft">{dd(inv.created_at)}{inv.client_username ? ` → @${inv.client_username}` : ""}</span>
                          <Pill tone={inv.status === "active" ? "accent" : inv.status === "expired" ? "warn" : "neutral"}>{inv.status}</Pill>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : null}
              <h3 className="mb-2 mt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.coaching.invitationsReceived} · {d.coaching.invitations_received.length}</h3>
              {d.coaching.invitations_received.length === 0 ? <p className="text-[13px] text-ink-faint">{m.coaching.none}</p> : (
                <ul className="space-y-1 text-[12.5px]">
                  {d.coaching.invitations_received.map((inv) => (
                    <li key={inv.id} className="flex items-center justify-between gap-2">
                      <span className="truncate text-ink-soft">@{inv.coach_username} · {dd(inv.started_at)}</span>
                      <Pill tone={inv.status === "active" ? "accent" : "neutral"}>{inv.status}</Pill>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={m.sections.auth} hint={m.auth.sessionsHint}>
              <KpiGrid cols={3}>
                <Kpi label={m.auth.logins} value={n(d.auth.logins_total)} accent />
                <Kpi label={m.auth.logins30d} value={n(d.auth.logins_30d)} />
                <Kpi label={m.auth.failed30d} value={n(d.auth.failed_30d)} warn={d.auth.failed_30d > 0} />
              </KpiGrid>
              <h3 className="mb-2 mt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.auth.history}</h3>
              {d.auth.history.length === 0 ? <p className="text-[13px] text-ink-faint">{m.auth.noHistory}</p> : (
                <Table head={<><Th>{t.admin.auth.th.when}</Th><Th>{t.admin.activity.th.action}</Th><Th>{t.admin.auth.th.provider}</Th><Th>{t.admin.auth.th.ip}</Th></>}>
                  {d.auth.history.map((h, i) => (
                    <tr key={i}>
                      <Td nowrap className="text-ink-soft">{dt(h.at)}</Td>
                      <Td>{m.auth.actions[h.action as keyof typeof m.auth.actions] ?? h.action}</Td>
                      <Td>{h.provider ?? c.none}</Td>
                      <Td className="font-mono text-[12px] text-ink-faint">{h.ip || c.none}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>

            <Section title={m.sections.devices} hint={m.devices.pwaHint}>
              <KpiGrid cols={3}>
                <Kpi label={m.devices.restNotify} value={String(p.rest_prefs?.notify) === "true" ? c.yes : c.no} />
                <Kpi label={m.devices.restSent} value={n(d.devices.rest_pushes_sent)} sub={d.devices.last_rest_push_at ? `${m.devices.lastRest}: ${dt(d.devices.last_rest_push_at)}` : undefined} />
                <Kpi label={m.devices.restCancelled} value={n(d.devices.rest_pushes_cancelled)} />
                <Kpi label={m.devices.notifications} value={n(d.devices.notifications)} sub={`${n(d.devices.notifications_unread)} ${m.devices.unread}`} />
              </KpiGrid>
              <h3 className="mb-2 mt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.devices.push}</h3>
              {d.devices.push_subscriptions.length === 0 ? <Note>{m.devices.noPush}</Note> : (
                <ul className="divide-y divide-line/60 text-[12.5px]">
                  {d.devices.push_subscriptions.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate" title={s.user_agent ?? ""}>{s.user_agent ?? c.none}</span>
                        <span className="block text-[11.5px] text-ink-faint">{m.devices.registered} {dt(s.created_at)} · {m.devices.updated} {dt(s.updated_at)}</span>
                      </span>
                      <ConfirmAction label={m.devices.remove} title={m.devices.removeTitle} body={m.devices.removeBody} tone="neutral" action={removePushSubscription.bind(null, s.id, p.id)} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>

        <div className="min-w-0">
          <Section title={m.sections.timeline} className="xl:sticky xl:top-6">
            <div id="timeline" className="max-h-[80vh] overflow-y-auto pr-1">
              <Timeline events={timeline} locale={locale} t={m.timeline} moreHref={moreHref} />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
