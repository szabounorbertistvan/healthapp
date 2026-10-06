"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  requestCoach, respondCoachRequest, searchGyms, setHomeGym, suggestGym, withdrawCoachRequest, type GymResult,
} from "@/app/gym-actions";
import type { GymCoach, GymHit, GymRef, InboxRequest, MyCoachRequest, MyGyms } from "@/lib/gym-data";
import { gymMapHref } from "@/lib/gym-map";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { Avatar } from "./social";
import { Card } from "./ui";

const FIELD =
  "mt-1.5 h-11 w-full rounded-2xl bg-bg px-3.5 text-[14px] text-ink outline-none ring-accent/50 focus:ring-2";
const BUTTON =
  "inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50";
const QUIET =
  "inline-flex h-9 items-center justify-center rounded-xl bg-bg px-3.5 text-[13px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50";
const LABEL = "text-[11px] font-semibold uppercase tracking-wider text-ink-faint";

function useGymError() {
  const { t } = useI18n();
  return (r: GymResult) => (r.error ? t.gyms.errors[r.error] : t.gyms.errors.generic);
}

// ---------- search ----------

/**
 * A search box over search_gyms(): the caller's city when empty, then
 * whatever matches name, city or street. Results are buttons; `exclude`
 * hides gyms already chosen.
 */
function GymSearch({
  onPick, placeholder, exclude = [], autoFocus = false, disabled = false,
}: {
  onPick: (g: GymHit) => void;
  placeholder: string;
  exclude?: string[];
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const m = t.gyms.my;
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GymHit[] | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      const found = await searchGyms(query);
      if (mine === seq.current) setHits(found);
    }, query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [query]);

  const shown = (hits ?? []).filter((h) => !exclude.includes(h.id));

  return (
    <div>
      <input
        className={FIELD}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        type="search"
      />
      {hits !== null ? (
        shown.length === 0 ? (
          query ? <p className="mt-2 text-[12.5px] leading-relaxed text-ink-faint">{m.noResults}</p> : null
        ) : (
          <ul className="mt-2 grid gap-1.5">
            {shown.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  disabled={disabled || g.status !== "active"}
                  onClick={() => onPick(g)}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl bg-bg px-3.5 py-2.5 text-left hover:bg-accent-soft/40 disabled:cursor-default disabled:hover:bg-bg"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold text-ink">{g.name}</span>
                    <span className="block truncate text-[12.5px] text-ink-faint">
                      {[g.address, g.city].filter(Boolean).join(", ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[12px] text-ink-faint">
                    {g.status === "pending" ? m.pending : (
                      <>
                        {fill(m.members, { n: g.members })}
                        {g.coaches > 0 ? <span className="block">{fill(m.coaches, { n: g.coaches })}</span> : null}
                      </>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

// ---------- suggest ----------

function SuggestGym({ pending }: { pending: GymRef[] }) {
  const { t } = useI18n();
  const s = t.gyms.suggest;
  const errorOf = useGymError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [link, setLink] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await suggestGym({ name, city, address, mapsUrl: link });
      if (!r.ok) {
        setError(errorOf(r));
        return;
      }
      setSent(true);
      setOpen(false);
      setName(""); setCity(""); setAddress(""); setLink("");
      router.refresh();
    });
  }

  return (
    <div className="mt-4">
      {pending.length > 0 ? (
        <div className="mb-3">
          <p className="text-[12.5px] font-semibold text-ink-soft">{s.yours}</p>
          <ul className="mt-1 text-[12.5px] text-ink-faint">
            {pending.map((g) => <li key={g.id}>{g.name} · {g.city}</li>)}
          </ul>
        </div>
      ) : null}
      {sent ? <p className="mb-2 text-[12.5px] text-accent-ink">{s.sent}</p> : null}
      {!open ? (
        <button type="button" onClick={() => { setOpen(true); setSent(false); }} className="text-[13px] font-semibold text-ink-soft underline-offset-4 hover:text-ink hover:underline">
          {s.toggle}
        </button>
      ) : (
        <form onSubmit={send} className="rounded-2xl bg-bg/60 p-3.5">
          <p className="font-display text-[15px] font-bold tracking-tight">{s.title}</p>
          <div className="grid gap-x-3 sm:grid-cols-2">
            <label className="mt-3 block text-[13px] font-semibold text-ink-soft">
              {s.name}
              <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
            </label>
            <label className="mt-3 block text-[13px] font-semibold text-ink-soft">
              {s.city}
              <input className={FIELD} value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} required />
            </label>
            <label className="mt-3 block text-[13px] font-semibold text-ink-soft">
              {s.address}
              <input className={FIELD} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} />
            </label>
            <label className="mt-3 block text-[13px] font-semibold text-ink-soft">
              {s.link}
              <input className={FIELD} value={link} onChange={(e) => setLink(e.target.value)} maxLength={500} inputMode="url" placeholder="https://maps.app.goo.gl/…" />
            </label>
          </div>
          {error ? <p className="mt-2 text-[12.5px] text-risk">{error}</p> : null}
          <div className="mt-3.5 flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={BUTTON}>{s.send}</button>
            <button type="button" onClick={() => setOpen(false)} className={QUIET + " h-11"}>{t.gyms.my.cancel}</button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------- my gym ----------

/** The account screens' "My gym": the gym, its board opt-in, and the picker. */
export function MyGymCard({ my }: { my: MyGyms }) {
  const { t } = useI18n();
  const m = t.gyms.my;
  const errorOf = useGymError();
  const router = useRouter();
  const [picking, setPicking] = useState(!my.home);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const home = my.home;

  function save(gymId: string | null, board: boolean) {
    setError(null);
    start(async () => {
      const r = await setHomeGym(gymId, board);
      if (!r.ok) {
        setError(errorOf(r));
        return;
      }
      setPicking(false);
      router.refresh();
    });
  }

  return (
    <Card plain>
      <p className={LABEL}>{m.title}</p>

      {home ? (
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-lg font-bold tracking-tight">{home.name}</p>
            <p className="text-[13px] text-ink-faint">{[home.address, home.city].filter(Boolean).join(", ")}</p>
            <a href={gymMapHref(home)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[12.5px] font-semibold text-accent-ink hover:underline">
              {m.openMap} ↗
            </a>
          </div>
          <div className="flex gap-2">
            {!picking ? <button type="button" className={QUIET} onClick={() => setPicking(true)}>{m.change}</button> : null}
            <button type="button" className={QUIET} disabled={busy} onClick={() => save(null, false)}>{m.remove}</button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-3 text-[14px] font-semibold text-ink">{m.none}</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-faint">{m.hint}</p>
        </>
      )}

      {home ? (
        <div className="mt-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-ink-soft">{m.board}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-faint">{m.boardHint}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={my.board}
            aria-label={m.board}
            disabled={busy}
            onClick={() => save(home.id, !my.board)}
            className={`inline-flex h-9 shrink-0 items-center justify-center rounded-xl px-3.5 text-[13px] font-semibold ${
              my.board ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-faint"
            }`}
          >
            {my.board ? m.on : m.off}
          </button>
        </div>
      ) : null}

      {picking ? (
        <div className="mt-4">
          <p className="text-[13px] font-semibold text-ink-soft">{m.searchLabel}</p>
          <GymSearch
            placeholder={m.searchPlaceholder}
            exclude={home ? [home.id] : []}
            disabled={busy}
            autoFocus={Boolean(home)}
            onPick={(g) => save(g.id, false)}
          />
          {home ? (
            <button type="button" className="mt-2 text-[12.5px] font-semibold text-ink-faint hover:text-ink" onClick={() => setPicking(false)}>
              {m.cancel}
            </button>
          ) : null}
          <SuggestGym pending={my.pending} />
        </div>
      ) : null}

      {error ? <p className="mt-2 text-[12.5px] text-risk">{error}</p> : null}
    </Card>
  );
}

// ---------- client: coaches at my gym ----------

function RequestButton({ coach, gymId }: { coach: GymCoach; gymId: string }) {
  const { t } = useI18n();
  const f = t.gyms.find;
  const errorOf = useGymError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  if (!coach.accepting_clients) {
    return <span className="inline-flex h-9 items-center rounded-xl bg-bg px-3.5 text-[12.5px] font-semibold text-ink-faint">{f.notAccepting}</span>;
  }
  if (coach.request_pending) {
    return <span className="inline-flex h-9 items-center rounded-xl bg-accent-soft px-3.5 text-[12.5px] font-semibold text-accent-ink">{f.requested}</span>;
  }
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className={QUIET}>{f.request}</button>;
  }
  return (
    <form
      className="mt-3 w-full"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await requestCoach(coach.coach_profile_id, gymId, note);
          if (!r.ok) {
            setError(errorOf(r));
            return;
          }
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <textarea
        className="w-full rounded-2xl bg-bg px-3.5 py-2.5 text-[14px] text-ink outline-none ring-accent/50 focus:ring-2"
        rows={3}
        maxLength={2000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={f.notePlaceholder}
        aria-label={f.notePlaceholder}
        autoFocus
      />
      {error ? <p className="mt-1 text-[12.5px] text-risk">{error}</p> : null}
      <div className="mt-2 flex gap-2">
        <button type="submit" disabled={busy} className={BUTTON}>{f.send}</button>
        <button type="button" onClick={() => setOpen(false)} className={QUIET + " h-11"}>{f.cancel}</button>
      </div>
    </form>
  );
}

function PendingRequests({ requests }: { requests: MyCoachRequest[] }) {
  const { t } = useI18n();
  const f = t.gyms.find;
  const errorOf = useGymError();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  if (requests.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-[13px] font-semibold text-ink-soft">{f.pendingTitle}</p>
      <ul className="mt-2 grid gap-1.5">
        {requests.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 rounded-2xl bg-bg px-3.5 py-2.5">
            <span className="flex min-w-0 items-center gap-2.5">
              <Avatar name={r.coach_name} url={r.coach_avatar} size="h-8 w-8" />
              <span className="min-w-0">
                {r.coach_slug ? (
                  <Link href={`/coaches/${r.coach_slug}`} className="block truncate text-[13.5px] font-semibold hover:underline">{r.coach_name}</Link>
                ) : (
                  <span className="block truncate text-[13.5px] font-semibold">{r.coach_name}</span>
                )}
                {r.gym_name ? <span className="block truncate text-[12px] text-ink-faint">{fill(f.pendingAt, { gym: r.gym_name })}</span> : null}
              </span>
            </span>
            <button
              type="button"
              disabled={busy}
              className="text-[12.5px] font-semibold text-ink-faint hover:text-risk"
              onClick={() => start(async () => {
                setError(null);
                const res = await withdrawCoachRequest(r.id);
                if (!res.ok) setError(errorOf(res));
                router.refresh();
              })}
            >
              {f.withdraw}
            </button>
          </li>
        ))}
      </ul>
      {error ? <p className="mt-1 text-[12.5px] text-risk">{error}</p> : null}
    </div>
  );
}

/**
 * /coach for someone without a coach: the published coach profiles located
 * at their gym, each with a request button, and the requests already sent.
 * No gym → a link to pick one.
 */
export function GymCoachesCard({
  gym, coaches, requests,
}: {
  gym: { id: string; name: string } | null;
  coaches: GymCoach[];
  requests: MyCoachRequest[];
}) {
  const { t } = useI18n();
  const f = t.gyms.find;
  return (
    <Card plain>
      <p className="font-display text-lg font-bold tracking-tight">{gym ? fill(f.title, { gym: gym.name }) : f.noGymTitle}</p>
      {!gym ? (
        <>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-soft">{f.noGym}</p>
          <Link href="/account" className={QUIET + " mt-3"}>{f.pickGym}</Link>
        </>
      ) : coaches.length === 0 ? (
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink-soft">{f.empty}</p>
      ) : (
        <ul className="mt-3 grid gap-2.5">
          {coaches.map((c) => (
            <li key={c.coach_profile_id} className="rounded-2xl bg-bg px-3.5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar name={c.display_name} url={c.avatar_url} size="h-10 w-10" />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold">{c.display_name}</span>
                    {c.headline ? <span className="block truncate text-[12.5px] text-ink-faint">{c.headline}</span> : null}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {/* The public Coach Discovery page: services, certifications, reviews. */}
                  <Link href={`/coaches/${c.slug}`} className="text-[12.5px] font-semibold text-ink-faint hover:text-ink">{f.profile}</Link>
                  <RequestButton coach={c} gymId={gym.id} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <PendingRequests requests={requests} />
    </Card>
  );
}

// ---------- coach: request inbox ----------

/**
 * Pending coaching requests on /clients and /dashboard — every request, from
 * a gym list or a public coach page (coaching_requests). Renders nothing when
 * there are none.
 */
export function CoachRequestsCard({ requests }: { requests: InboxRequest[] }) {
  const { t } = useI18n();
  const r = t.gyms.inbox;
  const errorOf = useGymError();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  if (requests.length === 0) return null;

  function answer(id: string, accept: boolean) {
    setError(null);
    start(async () => {
      const res = await respondCoachRequest(id, accept);
      if (!res.ok) setError(errorOf(res));
      router.refresh();
    });
  }

  return (
    <Card plain>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display text-lg font-bold tracking-tight">{r.title} · {requests.length}</p>
        <Link href="/requests" className="text-[13px] font-semibold text-accent-ink hover:underline">{r.seeAll} →</Link>
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-faint">{r.hint}</p>
      <ul className="mt-3 grid gap-2.5">
        {requests.map((q) => (
          <li key={q.id} className="rounded-2xl bg-bg px-3.5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={q.client_name} url={q.client_avatar} size="h-10 w-10" />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold">{q.client_name}</span>
                  <span className="block truncate text-[12.5px] text-ink-faint">
                    {[
                      q.gym_name ? fill(r.foundAt, { gym: q.gym_name }) : null,
                      q.service_name ? fill(r.service, { name: q.service_name }) : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Link href={`/people/${q.client_id}`} className="text-[12.5px] font-semibold text-ink-faint hover:text-ink">{r.profile}</Link>
                <button type="button" disabled={busy} onClick={() => answer(q.id, false)} className={QUIET}>{r.decline}</button>
                <button type="button" disabled={busy} onClick={() => answer(q.id, true)} className="inline-flex h-9 items-center rounded-xl bg-accent px-3.5 text-[13px] font-bold text-accent-fg hover:opacity-90 disabled:opacity-50">
                  {r.accept}
                </button>
              </span>
            </div>
            {q.message ? <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-ink-soft">{q.message}</p> : null}
          </li>
        ))}
      </ul>
      {error ? <p className="mt-2 text-[12.5px] text-risk">{error}</p> : null}
    </Card>
  );
}
