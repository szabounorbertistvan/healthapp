"use client";
// Social v2 pieces that sit beside social.tsx rather than inside it: the badge
// glyph, the mention suggester the post composer shares with nothing else, the
// share buttons for achievements and the Fitness Score, the privacy card, and
// the live people-search box.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { applyMention, commentSegments, mentionQueryAt, type PostVisibility, type ProfileVisibility } from "@healthapp/shared";
import {
  mentionCandidates, publishFitnessScore, shareAchievement, shareFitnessScore, updateSocialPrivacy,
} from "@/app/social-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { PersonRow, ProfileBadge, SocialPrivacy } from "@/lib/types";
import { NavIcon } from "./client-nav";
import { Card } from "./ui";
import { Avatar, VisibilityPicker } from "./social";

const CHECK = "m5 12 5 5 9-10";

/** Glyphs for the badge catalog's `icon` names. Unknown names fall back to the trophy. */
const BADGE_GLYPH: Record<string, string> = {
  dumbbell: "M6.5 6.5v11M9.5 8.5v7M14.5 8.5v7M17.5 6.5v11M9.5 12h5",
  flame: "M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-8 0 4-4 6-4 12 0 4 3 7 7 7z",
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4",
  check: CHECK,
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 12h.01",
  food: "M7 3v8a3 3 0 0 0 6 0V3M10 3v18M17 3c-1.5 1-2 3-2 6s.5 4 2 4v8",
};

export function BadgeGlyph({ icon, className = "h-5 w-5" }: { icon: string | null | undefined; className?: string }) {
  return <NavIcon d={BADGE_GLYPH[icon ?? ""] ?? BADGE_GLYPH.trophy!} className={className} />;
}

// ---------- text with resolved mentions ----------

/**
 * A caption or comment rendered as elements. A handle is a link only when
 * `mentions` has a row for it — the database decided, not the text — and
 * there is no HTML anywhere in this path.
 */
export function MentionText({
  text, mentions, className,
}: {
  text: string;
  mentions: { user_id: string; username: string }[];
  className?: string;
}) {
  const segments = commentSegments(text, mentions);
  return (
    <p className={className}>
      {segments.map((segment, i) =>
        segment.kind === "mention" ? (
          <Link key={i} href={`/people/${segment.user_id}`} className="font-semibold text-accent-ink hover:underline">
            {segment.text}
          </Link>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

// ---------- @ suggestions for a text box ----------

/**
 * "@mar" → people, for any textarea or input. The list is server-side
 * (social_mention_candidates): the browser is never handed a directory, and
 * the query is debounced so typing does not fire a request per key.
 */
export function useMentionSuggest(postId: string | null) {
  const [query, setQuery] = useState<{ query: string; start: number } | null>(null);
  const [suggestions, setSuggestions] = useState<PersonRow[]>([]);

  useEffect(() => {
    if (!query) {
      setSuggestions([]);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      const people = await mentionCandidates(query.query, postId);
      if (live) setSuggestions(people);
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, postId]);

  return {
    suggestions,
    /** Call on every change / caret move with the value and caret position. */
    track(value: string, caret: number) {
      setQuery(mentionQueryAt(value, caret));
    },
    /** The new value and caret after choosing someone, or null if nothing is being typed. */
    choose(value: string, caret: number, person: PersonRow): { body: string; caret: number } | null {
      if (!query || !person.username) return null;
      const next = applyMention(value, query.start, caret, person.username);
      setQuery(null);
      setSuggestions([]);
      return next;
    },
    clear() {
      setQuery(null);
      setSuggestions([]);
    },
  };
}

export function MentionSuggestions({ people, onPick }: { people: PersonRow[]; onPick: (person: PersonRow) => void }) {
  if (people.length === 0) return null;
  return (
    <ul className="mb-2 max-h-48 overflow-y-auto rounded-xl border border-line bg-surface p-1" role="listbox">
      {people.map((person) => (
        <li key={person.id}>
          <button
            type="button"
            // mousedown, not click: a click would blur the textarea first and lose the caret.
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(person);
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-bg"
          >
            <Avatar name={person.name} url={person.avatar_url} size="h-7 w-7" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{person.name}</span>
            {person.username ? <span className="shrink-0 text-[12px] text-ink-faint">@{person.username}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------- achievements ----------

/**
 * The badges on a profile. The owner gets a Share control on each one they
 * have not posted yet; nobody else sees any control, and `shared` is never
 * true for them (social_badges answers it only to the owner).
 */
export function BadgeShelf({ badges, mine }: { badges: ProfileBadge[]; mine: boolean }) {
  const { t, locale } = useI18n();
  const s = t.common.social;
  const df = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {badges.map((b) => (
        <li key={b.slug} className="flex items-center gap-3 rounded-2xl bg-bg px-3.5 py-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-fg">
            <BadgeGlyph icon={b.icon} className="h-5 w-5 [stroke-width:2.1]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold">{locale === "ro" ? b.name_ro : b.name_en}</span>
            <span className="block text-[11.5px] text-ink-faint">{df.format(new Date(b.awarded_at))}</span>
          </span>
          {mine ? <ShareBadge slug={b.slug} shared={b.shared} label={s.shareAchievement} doneLabel={s.achievementShared} /> : null}
        </li>
      ))}
    </ul>
  );
}

function ShareBadge({ slug, shared, label, doneLabel }: { slug: string; shared: boolean; label: string; doneLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(shared);
  const [error, setError] = useState(false);
  if (done) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-accent-ink">
        <NavIcon d={CHECK} className="h-3.5 w-3.5 [stroke-width:2.4]" />
        {doneLabel}
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          setError(false);
          // Followers by default, like every other share: a badge is small news.
          const r = await shareAchievement(slug, "followers");
          if (r.ok) setDone(true);
          else setError(true);
          router.refresh();
        })
      }
      className={`inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-[12px] font-semibold disabled:opacity-50 ${
        error ? "bg-risk-soft text-risk" : "bg-surface text-ink-soft hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

// ---------- the Fitness Score ----------

/**
 * Share the milestone the current score has reached. The number shown here is
 * only a hint — the server recomputes the score when it builds the post, so
 * nothing the browser holds ends up in the payload.
 */
export function ShareFitnessScore({ milestone }: { milestone: number | null }) {
  const { t } = useI18n();
  const s = t.common.social;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [visibility, setVisibility] = useState<PostVisibility>("followers");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card plain className="mt-4">
      <h2 className="font-display text-lg font-bold tracking-tight">{s.shareScoreTitle}</h2>
      {milestone === null ? (
        <p className="mt-1.5 text-[13px] text-ink-soft">{s.shareScoreBelow}</p>
      ) : done ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-accent-ink">
          <NavIcon d={CHECK} className="h-4 w-4 [stroke-width:2.4]" />
          {s.shared}
        </p>
      ) : (
        <div className="mt-2 space-y-3">
          <p className="text-[13px] leading-relaxed text-ink-soft">{fill(s.shareScoreBody, { milestone })}</p>
          <VisibilityPicker value={visibility} onChange={setVisibility} />
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await shareFitnessScore(visibility);
                if (r.ok) setDone(true);
                else setError(r.message ?? s.loadFailed);
                router.refresh();
              })
            }
            className="flex h-11 w-full items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50 sm:w-auto"
          >
            {fill(s.shareScoreCta, { milestone })}
          </button>
          {error ? <p className="text-xs text-risk">{error}</p> : null}
        </div>
      )}
    </Card>
  );
}

// ---------- privacy ----------

/**
 * Who sees the numbers on your social profile. Two settings and one explicit
 * "publish my score" — the profile never shows a live score, only the one you
 * last put there.
 */
export function SocialPrivacyCard({ privacy }: { privacy: SocialPrivacy }) {
  const { t, locale } = useI18n();
  const s = t.common.social;
  const router = useRouter();
  const [stats, setStats] = useState<ProfileVisibility>(privacy.stats_visibility);
  const [score, setScore] = useState<ProfileVisibility>(privacy.fitness_score_visibility);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const df = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short" });

  function save(nextStats: ProfileVisibility, nextScore: ProfileVisibility) {
    setStats(nextStats);
    setScore(nextScore);
    start(async () => {
      const r = await updateSocialPrivacy({ stats: nextStats, fitnessScore: nextScore });
      setNote(r.ok ? { ok: true, text: s.privacySaved } : { ok: false, text: r.message ?? s.loadFailed });
      router.refresh();
    });
  }

  const select = (value: ProfileVisibility, onChange: (v: ProfileVisibility) => void, label: string) => (
    <select
      value={value}
      aria-label={label}
      disabled={pending}
      onChange={(e) => onChange(e.target.value as ProfileVisibility)}
      className="mt-1.5 h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-accent disabled:opacity-60"
    >
      {(["public", "followers", "private"] as const).map((v) => (
        <option key={v} value={v}>{s.visibility[v]}</option>
      ))}
    </select>
  );

  return (
    <Card plain>
      <h2 className="font-display text-lg font-bold tracking-tight">{s.privacyTitle}</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-faint">{s.privacyHint}</p>

      <label className="mt-4 block text-[13px] font-semibold">
        {s.statsVisibility}
        {select(stats, (v) => save(v, score), s.statsVisibility)}
      </label>

      <label className="mt-4 block text-[13px] font-semibold">
        {s.fitnessVisibility}
        {select(score, (v) => save(stats, v), s.fitnessVisibility)}
      </label>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">{s.fitnessVisibilityHint}</p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await publishFitnessScore();
              setNote(r.ok ? { ok: true, text: s.privacySaved } : { ok: false, text: r.message ?? s.loadFailed });
              router.refresh();
            })
          }
          className="inline-flex h-10 items-center rounded-full bg-bg px-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
        >
          {s.publishScore}
        </button>
        <span className="text-[12px] text-ink-faint">
          {privacy.fitness_score_public !== null && privacy.fitness_score_public_at
            ? fill(s.scorePublished, { score: privacy.fitness_score_public, date: df.format(new Date(privacy.fitness_score_public_at)) })
            : s.scoreNotPublished}
        </span>
      </div>
      {note ? <p className={`mt-2 text-xs ${note.ok ? "text-accent-ink" : "text-risk"}`}>{note.text}</p> : null}
    </Card>
  );
}

// ---------- people search ----------

/**
 * The Discover search box: results follow the typing (debounced) by updating
 * the URL, so the list is still server-rendered, shareable and back-button
 * friendly, and a plain submit works with JavaScript off.
 */
export function PeopleSearchBox({ placeholder, cityPlaceholder, submitLabel }: {
  placeholder: string;
  cityPlaceholder: string;
  submitLabel: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [city, setCity] = useState(params.get("city") ?? "");
  const [pending, start] = useTransition();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const next = new URLSearchParams();
      if (q.trim()) next.set("q", q.trim());
      if (city.trim()) next.set("city", city.trim());
      start(() => router.replace(`/people${next.size ? `?${next}` : ""}`, { scroll: false }));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, city, router]);

  return (
    <form className="mt-5 flex flex-wrap gap-2 sm:mt-6" role="search" aria-busy={pending}>
      <label className="flex h-[42px] min-w-[10rem] flex-1 items-center gap-2.5 rounded-2xl bg-surface px-3.5">
        <NavIcon d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3" className={`h-[17px] w-[17px] shrink-0 ${pending ? "animate-pulse text-accent" : "text-ink-faint"}`} />
        <input
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
        />
      </label>
      {/* City is free text on the profile and already shown there, so it is
          a filter rather than a new kind of data. */}
      <label className="flex h-[42px] min-w-[8rem] items-center gap-2.5 rounded-2xl bg-surface px-3.5">
        <input
          name="city"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder={cityPlaceholder}
          aria-label={cityPlaceholder}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
        />
      </label>
      <button
        type="submit"
        className="flex h-[42px] shrink-0 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90"
      >
        {submitLabel}
      </button>
    </form>
  );
}
