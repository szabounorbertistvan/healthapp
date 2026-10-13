import Link from "next/link";
import { notFound } from "next/navigation";
import {
  GYM_RECORD_KINDS, GYM_RECORD_PERIODS, getGymCoaches, getGymRecordLifts, getGymRecords, getGymStats, getMyGyms,
  type GymRecordKind, type GymRecordPeriod,
} from "@/lib/gym-data";
import { getProfile } from "@/lib/data";
import { GymRecords } from "@/components/gym-records";
import { gymMapHref, gymWhere } from "@/lib/gym-map";
import { gymOpenState } from "@healthapp/shared";
import { CountBars, SetHomeGymButton } from "@/components/gym-stats";
import { Avatar } from "@/components/social";
import { Card } from "@/components/ui";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /gyms/[id] — one gym: where it is, Google's rating and hours when an admin
 * linked it, its members and coaches, this week and this month, its busiest
 * hours and days — and, first, its records: who lifts the most here
 * (20261117110000). Every activity number is null below three people
 * (gym_stats, 20261117100000) and the page says so. The gym-vs-gym rank is
 * admin-only for now, so it is not shown here.
 */
export default async function GymPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lift?: string; kind?: string; period?: string }>;
}) {
  const [{ t, locale }, { id }, q] = await Promise.all([getI18n(), params, searchParams]);
  if (!UUID.test(id)) notFound();
  const kind: GymRecordKind = (GYM_RECORD_KINDS as readonly string[]).includes(q.kind ?? "") ? (q.kind as GymRecordKind) : "e1rm";
  const period: GymRecordPeriod = (GYM_RECORD_PERIODS as readonly string[]).includes(q.period ?? "") ? (q.period as GymRecordPeriod) : "all";
  const [stats, coaches, lifts, my, profile] = await Promise.all([
    getGymStats(id), getGymCoaches(id), getGymRecordLifts(id), getMyGyms(), getProfile(),
  ]);
  if (!stats) notFound();
  // The lift in the URL if this gym has it, else the most contested one.
  const lift = lifts.find((l) => l.exercise_id === q.lift)?.exercise_id ?? lifts[0]?.exercise_id ?? (q.lift && UUID.test(q.lift) ? q.lift : null);
  const records = lift ? await getGymRecords(id, lift, kind, period) : [];

  // "Open now" on the gym's own clock (Romanian gyms: Bucharest time).
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date());
  const part = (k: string) => clock.find((x) => x.type === k)?.value ?? "";
  const dayIdx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday"));
  const s = t.gyms.stats;
  const g = stats.gym;
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");
  const label = "text-[11px] font-semibold uppercase tracking-wider text-ink-faint";
  const hours = Array.from({ length: 24 }, (_, i) => String(i));
  const openState = gymOpenState(stats.gym.opening_periods, dayIdx, Number(part("hour")), Number(part("minute")));
  const any = (o: Record<string, boolean> | null) => !!o && Object.values(o).some(Boolean);
  const facilities = [
    any(stats.gym.parking) ? s.parking : null,
    stats.gym.accessibility?.wheelchairAccessibleEntrance ? s.accessible : null,
    stats.gym.payment?.acceptsCreditCards || stats.gym.payment?.acceptsDebitCards || stats.gym.payment?.acceptsNfc ? s.cards : null,
  ].filter(Boolean) as string[];
  const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/gyms" className="text-[12.5px] font-semibold text-ink-faint hover:text-ink">← {s.back}</Link>

      {g.has_photo ? (
        <figure className="overflow-hidden rounded-3xl bg-surface">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/gyms/${g.id}/photo`} alt={g.name} className="h-[clamp(160px,30vw,300px)] w-full object-cover" />
          {g.photo_attribution ? (
            <figcaption className="px-4 py-1.5 text-[11px] text-ink-faint">{fill(s.photoBy, { name: g.photo_attribution })}</figcaption>
          ) : null}
        </figure>
      ) : null}

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{g.name}</h1>
          <p className="mt-1 text-[13.5px] text-ink-soft">{gymWhere(g.address, g.city)}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
            <a href={gymMapHref(g)} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-ink hover:underline">{s.openMap} ↗</a>
            {g.google_rating != null ? (
              <span className="text-ink-soft">★ {fill(s.rating, { r: Number(g.google_rating).toFixed(1), n: nf.format(g.google_ratings_total ?? 0) })}</span>
            ) : null}
            {openState !== "unknown" ? (
              <span className={`font-semibold ${openState === "open" ? "text-accent-ink" : "text-ink-faint"}`}>
                ● {openState === "open" ? s.openNow : s.closedNow}
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {g.phone ? (
              <a href={`tel:${g.phone.replace(/[^\d+]/g, "")}`} className="inline-flex h-9 items-center rounded-full bg-surface px-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink">
                {s.call} · {g.phone}
              </a>
            ) : null}
            {g.website ? (
              <a href={g.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex h-9 items-center rounded-full bg-surface px-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink">
                {s.site} ↗
              </a>
            ) : null}
            {facilities.map((f) => (
              <span key={f} className="inline-flex h-9 items-center rounded-full bg-bg px-3.5 text-[12px] text-ink-faint">{f}</span>
            ))}
          </div>
          {g.summary ? <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-soft">{g.summary}</p> : null}
          {g.google_business_status && g.google_business_status !== "OPERATIONAL" ? (
            <p className="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-[12.5px] font-semibold text-warn">{s.closed}</p>
          ) : null}
        </div>
        <SetHomeGymButton gymId={g.id} isHome={stats.is_home} />
      </header>

      <GymRecords
        gymId={g.id}
        lifts={lifts}
        rows={records}
        lift={lift}
        kind={kind}
        period={period}
        onBoards={my.board}
        unit={profile?.weight_unit ?? "kg"}
        locale={locale}
        t={t.gyms.records}
      />

      <div className="grid grid-cols-3 gap-3">
        {[
          { k: s.members, v: stats.members },
          { k: s.coaches, v: stats.coaches },
          { k: s.onBoard, v: stats.board },
        ].map((x) => (
          <Card plain key={x.k} className="text-center">
            <p className="font-display text-2xl font-extrabold tabular-nums">{nf.format(x.v)}</p>
            <p className="mt-0.5 text-[12px] text-ink-faint">{x.k}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {([["week", stats.week], ["month", stats.month]] as const).map(([k, v]) => (
          <Card plain key={k}>
            <p className={label}>{s[k]}</p>
            {v ? (
              <div className="mt-2 space-y-0.5 text-[14px]">
                <p className="font-display text-xl font-bold">{fill(s.workouts, { n: nf.format(v.workouts) })}</p>
                <p className="text-ink-soft">{fill(s.athletes, { n: nf.format(v.athletes) })}</p>
                {"volume_kg" in v ? <p className="text-ink-soft">{fill(s.volume, { n: nf.format(v.volume_kg) })}</p> : null}
              </div>
            ) : (
              <div className="mt-2">
                <p className="text-[14px] font-semibold text-ink-soft">{s.notEnough}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-faint">{s.notEnoughHint}</p>
              </div>
            )}
          </Card>
        ))}
      </div>

      {stats.my_month > 0 ? <p className="text-[13px] text-ink-soft">{fill(s.mine, { n: stats.my_month })}</p> : null}

      {stats.busy_hours && stats.busy_days ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card plain>
            <p className={label}>{s.busyHours}</p>
            <div className="mt-5">
              <CountBars values={stats.busy_hours} labels={hours} every={3} caption={s.last30} />
            </div>
          </Card>
          <Card plain>
            <p className={label}>{s.busyDays}</p>
            <div className="mt-5">
              <CountBars values={stats.busy_days} labels={s.days} caption={s.last30} />
            </div>
          </Card>
        </div>
      ) : null}

      {g.opening_hours && g.opening_hours.length > 0 ? (
        <Card plain>
          <p className={label}>{s.hours}</p>
          <ul className="mt-2 space-y-0.5 text-[13px] text-ink-soft">
            {g.opening_hours.map((line) => <li key={line}>{line}</li>)}
          </ul>
          {g.google_refreshed_at ? (
            <p className="mt-2 text-[11px] text-ink-faint">{fill(s.googleData, { date: fmtDay(g.google_refreshed_at) })}</p>
          ) : null}
        </Card>
      ) : null}

      <Card plain>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={label}>{s.coachesHere}</p>
          {stats.is_home ? (
            <Link href="/leaderboards?scope=gym" className="text-[12.5px] font-semibold text-accent-ink hover:underline">{s.board} →</Link>
          ) : null}
        </div>
        {coaches.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-faint">{s.noCoaches}</p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {coaches.map((c) => (
              <li key={c.coach_profile_id}>
                <Link href={`/coaches/${c.slug}`} className="flex items-center gap-3 rounded-2xl bg-bg px-3.5 py-2.5 hover:bg-accent-soft/40">
                  <Avatar name={c.display_name} url={c.avatar_url} size="h-10 w-10" />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold">{c.display_name}</span>
                    {c.headline ? <span className="block truncate text-[12.5px] text-ink-faint">{c.headline}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
