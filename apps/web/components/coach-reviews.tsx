"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { BUTTON, FIELD, HINT, LABEL, SMALL_BUTTON } from "@/lib/form-classes";
import {
  REVIEW_BODY_MAX, REVIEW_RESPONSE_MAX, distributionBars,
  type CoachMyReviews, type CoachReview, type MyReviewState, type PublicReview, type PublicReviews, type ReviewStats,
} from "@/lib/coach-review";
import type { ActionResult } from "@/app/actions";
import { deleteMyReview, respondToReview, submitReview } from "@/app/review-actions";
import { Avatar } from "./social";
import { ModerationMenuButton } from "./moderation";

// Coach reviews (20261106100000). The public section on /coaches/[slug], the
// form on /coaches/[slug]/review and the coach's own list on /reviews. Every
// number here is the database's (derived columns); the screens only draw it.

const STAR_PATH = "m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z";

/** Five stars, the first `rating` filled. Decorative: the label carries the number. */
export function Stars({ rating, size = "h-4 w-4", label }: { rating: number; size?: string; label: string }) {
  return (
    <span role="img" aria-label={label} className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} viewBox="0 0 24 24" aria-hidden className={`${size} ${n <= Math.round(rating) ? "text-accent" : "text-line"}`} fill="currentColor">
          <path d={STAR_PATH} />
        </svg>
      ))}
    </span>
  );
}

function useDate() {
  const { locale } = useI18n();
  return (iso: string) => new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(iso));
}

/** The average, the count, and a bar per star value. */
export function ReviewSummary({ stats }: { stats: ReviewStats }) {
  const { t, locale } = useI18n();
  const r = t.coachProfile.reviews;
  if (stats.count === 0 || stats.average === null) return <p className="text-[14px] text-ink-soft" data-testid="reviews-none">{r.none}</p>;
  const avg = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(stats.average);
  return (
    <div className="flex flex-wrap items-center gap-6" data-testid="reviews-summary" data-count={stats.count} data-average={stats.average}>
      <div>
        <p className="font-display text-[40px] font-extrabold leading-none tracking-tight">{avg}</p>
        <Stars rating={stats.average} label={fill(r.starsLabel, { n: avg })} />
        <p className="mt-1 text-[12.5px] text-ink-faint">{stats.count} {stats.count === 1 ? r.one : r.many}</p>
      </div>
      <ul className="grid min-w-48 flex-1 gap-1">
        {distributionBars(stats.distribution).map((b) => (
          <li key={b.stars} className="flex items-center gap-2 text-[12px] text-ink-faint">
            <span className="w-3 tabular-nums">{b.stars}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${b.pct}%` }} />
            </span>
            <span className="w-6 text-right tabular-nums">{b.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewCard({ review, coachName, report }: {
  review: Omit<PublicReview, "is_mine"> & { is_mine?: boolean; status?: string };
  coachName: string;
  report?: React.ReactNode;
}) {
  const { t } = useI18n();
  const r = t.coachProfile.reviews;
  const date = useDate();
  return (
    <article className="rounded-3xl bg-surface p-4 sm:p-5" data-testid="review" data-rating={review.rating} data-status={review.status ?? "published"}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={review.reviewer_name} url={review.reviewer_avatar} size="h-10 w-10" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{review.reviewer_name}{review.is_mine ? ` · ${r.yours}` : ""}</p>
            <p className="text-[12px] text-ink-faint">
              {r.basis[review.basis]} · {date(review.created_at)}{review.edited_at ? ` · ${r.edited}` : ""}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Stars rating={review.rating} label={fill(r.starsLabel, { n: review.rating })} />
          {report}
        </div>
      </div>
      {review.body ? <p className="mt-3 whitespace-pre-line text-[14px] leading-relaxed text-ink-soft" data-testid="review-body">{review.body}</p> : null}
      {review.coach_response ? (
        <div className="mt-3 rounded-2xl bg-bg px-4 py-3" data-testid="review-response">
          <p className="text-[12px] font-semibold text-ink-faint">{fill(r.response, { name: coachName })}</p>
          <p className="mt-1 whitespace-pre-line text-[13.5px] leading-relaxed text-ink-soft">{review.coach_response}</p>
        </div>
      ) : null}
    </article>
  );
}

/**
 * The public page's section: the summary, the reader's way in (write or edit,
 * only when they may), and the newest reviews — each reportable through the
 * existing report sheet by anyone signed in but its author.
 */
export function PublicReviewsSection({ reviews, coachName, slug, state, signedIn }: {
  reviews: PublicReviews;
  coachName: string;
  slug: string;
  state: MyReviewState | null;
  signedIn: boolean;
}) {
  const { t } = useI18n();
  const r = t.coachProfile.reviews;
  const cta = state?.review
    ? (state.review.status === "hidden" ? null : r.edit)
    : state?.eligible ? r.write : null;
  return (
    <div className="grid gap-4" data-testid="public-reviews">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <ReviewSummary stats={reviews} />
        {cta ? (
          <Link href={`/coaches/${slug}/review`} className={SMALL_BUTTON} data-testid="review-cta">{cta}</Link>
        ) : null}
      </div>
      {state?.review?.status === "hidden" ? <p className="text-[13px] text-ink-faint">{r.hiddenNote}</p> : null}
      {reviews.items.length > 0 ? (
        <div className="grid gap-2.5">
          {reviews.items.map((rv) => (
            <ReviewCard key={rv.id} review={rv} coachName={coachName}
              report={signedIn && !rv.is_mine ? (
                <ModerationMenuButton target={{ userId: "", name: rv.reviewer_name }} reviewId={rv.id}
                  muted={false} blocked={false} place="review" size="small" />
              ) : null} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function useRun(errors: Record<string, string>) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>, after?: () => void) => {
    setError(null);
    start(async () => {
      const result = await fn();
      if (!result.ok) {
        setError((result.errorCode && errors[result.errorCode]) || errors.generic || null);
      } else {
        after?.();
      }
      router.refresh();
    });
  };
  return { run, busy, error };
}

/** Pick 1–5 stars: a radio group, keyboard-friendly. */
function StarInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { t } = useI18n();
  const f = t.coachProfile.reviews.form;
  return (
    <div role="radiogroup" aria-label={f.rating} className="mt-1.5 flex gap-1" data-testid="review-stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} data-star={n}
          aria-label={fill(n === 1 ? f.star : f.stars, { n })} onClick={() => onChange(n)}
          className="rounded-lg p-1 outline-none ring-accent/50 focus-visible:ring-2">
          <svg viewBox="0 0 24 24" aria-hidden className={`h-8 w-8 ${n <= value ? "text-accent" : "text-line"}`} fill="currentColor">
            <path d={STAR_PATH} />
          </svg>
        </button>
      ))}
    </div>
  );
}

/** Write, edit or delete the reader's one review of a coach. */
export function ReviewForm({ profileId, slug, coachName, state }: {
  profileId: string; slug: string; coachName: string; state: MyReviewState;
}) {
  const { t } = useI18n();
  const r = t.coachProfile.reviews;
  const f = r.form;
  const { run, busy, error } = useRun(r.errors);
  const existing = state.review;
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [body, setBody] = useState(existing?.body ?? "");
  const [done, setDone] = useState<string | null>(null);

  if (existing?.status === "hidden") {
    return <p className="rounded-3xl bg-surface px-6 py-8 text-center font-semibold" data-testid="review-hidden">{f.hidden}</p>;
  }
  if (!existing && !state.eligible) {
    return <p className="rounded-3xl bg-surface px-6 py-8 text-center font-semibold" data-testid="review-not-eligible">{fill(f.notEligible, { name: coachName })}</p>;
  }
  return (
    <div className="grid gap-4 rounded-3xl bg-surface p-5" data-testid="review-form">
      <div>
        <p className={LABEL}>{f.rating}</p>
        <StarInput value={rating} onChange={(n) => { setRating(n); setDone(null); }} />
      </div>
      <label className={LABEL}>{f.body}
        <textarea value={body} onChange={(e) => { setBody(e.target.value); setDone(null); }} maxLength={REVIEW_BODY_MAX} rows={5}
          className={`${FIELD} h-auto py-2.5`} data-testid="review-text" />
        <span className={HINT}>{fill(f.bodyHint, { name: coachName })}</span>
      </label>
      {error ? <p role="alert" className="text-[13px] text-risk">{error}</p> : null}
      {done ? (
        <p role="status" className="text-[13.5px] font-semibold text-accent-ink" data-testid="review-done">
          {done} <Link href={`/coaches/${slug}#reviews`} className="underline">{fill(f.viewProfile, { name: coachName })}</Link>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BUTTON} disabled={busy || rating < 1} data-testid="review-submit"
          onClick={() => run(() => submitReview({ profileId, slug, rating, body: body.trim() || null }),
            () => setDone(existing ? f.updated : f.published))}>
          {existing ? f.update : f.submit}
        </button>
        {existing ? (
          <button type="button" className={SMALL_BUTTON} disabled={busy} data-testid="review-delete"
            onClick={() => { if (window.confirm(f.deleteConfirm)) run(() => deleteMyReview(existing.id, slug), () => { setDone(f.deleted); setRating(0); setBody(""); }); }}>
            {f.delete}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AnswerBox({ review }: { review: CoachReview }) {
  const { t } = useI18n();
  const r = t.coachProfile.reviews;
  const c = r.coach;
  const { run, busy, error } = useRun(r.errors);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(review.coach_response ?? "");
  if (review.status !== "published") return null;
  if (!open) {
    return (
      <button type="button" className={SMALL_BUTTON} onClick={() => setOpen(true)} data-testid="review-answer">
        {review.coach_response ? c.editAnswer : c.answer}
      </button>
    );
  }
  return (
    <div className="grid w-full gap-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={REVIEW_RESPONSE_MAX} rows={3}
        placeholder={c.answerPlaceholder} aria-label={c.answerPlaceholder} className={`${FIELD} h-auto py-2.5`} data-testid="review-answer-text" />
      {error ? <p role="alert" className="text-[13px] text-risk">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON} disabled={busy || !text.trim()} data-testid="review-answer-save"
          onClick={() => run(() => respondToReview(review.id, text), () => setOpen(false))}>{c.save}</button>
        {review.coach_response ? (
          <button type="button" className={SMALL_BUTTON} disabled={busy}
            onClick={() => run(() => respondToReview(review.id, ""), () => { setText(""); setOpen(false); })}>{c.remove}</button>
        ) : null}
        <button type="button" className="px-2 text-[13px] font-semibold text-ink-faint hover:text-ink" onClick={() => setOpen(false)}>{c.cancel}</button>
      </div>
    </div>
  );
}

/** The coach's own list: every review about them, the answer box, and Report (never edit or delete). */
export function CoachReviewsList({ data, coachName }: { data: CoachMyReviews; coachName: string }) {
  const { t } = useI18n();
  const c = t.coachProfile.reviews.coach;
  return (
    <div className="grid gap-5" data-testid="coach-reviews">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ReviewSummary stats={data} />
        <Link href={`/coaches/${data.slug}#reviews`} className="text-[13px] font-semibold text-accent-ink hover:underline">{c.viewPublic} ↗</Link>
      </div>
      {data.items.length === 0 ? (
        <div className="rounded-3xl bg-surface px-6 py-10 text-center">
          <p className="font-display text-lg font-bold">{c.empty}</p>
          <p className="mt-1 text-[13.5px] text-ink-soft">{c.emptyHint}</p>
        </div>
      ) : (
        <div className="grid gap-2.5">
          {data.items.map((rv) => (
            <div key={rv.id} className="grid gap-2">
              <ReviewCard review={rv} coachName={coachName}
                report={rv.status === "published" ? (
                  <ModerationMenuButton target={{ userId: "", name: rv.reviewer_name }} reviewId={rv.id}
                    muted={false} blocked={false} place="review" size="small" />
                ) : <span className="ml-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{c.hidden}</span>} />
              <AnswerBox review={rv} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
