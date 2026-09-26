// What a post can be handed to something outside the app.
//
// PREPARATION, not an integration: there is no Instagram API here and none is
// planned in this step. What this gives is one shape — `SharePayload` — that a
// future "share to…" button, an OG image route or the existing share-card
// renderer can all read, for every kind of post the feed carries.
//
// The rule it exists to enforce: a share payload is built ONLY from a post's
// stored snapshot (`social_posts.payload`), never from a live read of the
// author's sets, food, measurements or body weight. The snapshot is what the
// author chose to publish; anything else would be republishing something they
// did not.
//
// `progress` posts are deliberately absent: they are the one type whose
// payload may carry a body weight the author typed in, and a card that travels
// outside the app is not where that belongs.
import { exerciseSnapshot, type PostPayload } from "@healthapp/shared";

/**
 * The estimated 1RM a PR post carries: exerciseSnapshot()'s — relevantOneRm(),
 * the figure /exercises and /progress show, rounded to one decimal because a
 * card is display. 0 when there is no estimate (bodyweight, more than 12
 * reps), which the card below already leaves out. Posts shared before this
 * keep the number they were published with.
 */
export function prShareOneRm(weight_kg: number, reps: number): number {
  return exerciseSnapshot("", { weight_kg, reps, is_pr: true }, "").estimated_1rm ?? 0;
}

export type ShareKind = "workout" | "pr" | "streak" | "challenge" | "program";

export type ShareStat = { label: string; value: string };

export type SharePayload = {
  kind: ShareKind;
  /** The one line that names the thing — "Push Day", "Bench Press". */
  title: string;
  /** The hero figure, already formatted. Null when the title is the whole story. */
  headline: string | null;
  /** Two to four supporting numbers. */
  stats: ShareStat[];
  /** ISO date, no time. */
  date: string | null;
};

/** The labels a caller supplies, so this module stays free of i18n plumbing. */
export type ShareLabels = {
  duration: string;
  volume: string;
  sets: string;
  exercises: string;
  load: string;
  prs: string;
  reps: string;
  oneRm: string;
  days: string;
  target: string;
  programDays: string;
  programExercises: string;
};

/**
 * Turn a post's stored snapshot into a share payload.
 *
 * Returns null for a post that has nothing shareable — a plain text post, a
 * progress post, or one whose payload never arrived. A caller that gets null
 * should not draw a Share button.
 */
export function sharePayloadFromPost(
  post: { type: string; payload: PostPayload; created_at: string },
  labels: ShareLabels,
  format: { n: (v: number) => string; duration: (min: number | null) => string | null },
): SharePayload | null {
  const p = post.payload;
  if (!p) return null;

  if (p.kind === "workout") {
    const duration = format.duration(p.duration_min);
    return {
      kind: "workout",
      title: p.name,
      headline: `${format.n(p.volume_kg)} kg`,
      stats: [
        ...(duration ? [{ label: labels.duration, value: duration }] : []),
        { label: labels.sets, value: format.n(p.sets) },
        { label: labels.exercises, value: format.n(p.exercises) },
        { label: labels.load, value: format.n(p.load) },
        // An empty "Personal records" row on a session that had none is worse
        // than no row, so it appears only when there is something in it.
        ...(p.prs > 0 ? [{ label: labels.prs, value: format.n(p.prs) }] : []),
      ],
      date: p.date,
    };
  }

  if (p.kind === "pr") {
    return {
      kind: "pr",
      title: p.exercise,
      headline: `${format.n(p.weight_kg)} kg × ${p.reps}`,
      stats: [
        { label: labels.reps, value: format.n(p.reps) },
        ...(p.estimated_1rm > 0 ? [{ label: labels.oneRm, value: `${format.n(p.estimated_1rm)} kg` }] : []),
      ],
      date: p.date,
    };
  }

  if (p.kind === "streak") {
    return {
      kind: "streak",
      title: p.title,
      headline: format.n(p.milestone),
      stats: [{ label: labels.days, value: format.n(p.streak_days) }],
      date: p.achieved_at,
    };
  }

  if (p.kind === "challenge_completed") {
    return {
      kind: "challenge",
      title: p.title_en,
      headline: format.n(p.value),
      stats: [{ label: labels.target, value: format.n(p.target) }],
      date: null,
    };
  }

  if (p.kind === "program") {
    return {
      kind: "program",
      title: p.name,
      headline: null,
      stats: [
        { label: labels.programDays, value: format.n(p.days) },
        { label: labels.programExercises, value: format.n(p.exercises) },
      ],
      date: null,
    };
  }

  // text and progress: nothing to put on a card that would not be either empty
  // or private.
  return null;
}

/**
 * Is this post worth offering a Share button for?
 *
 * A private post is excluded on purpose: a card that leaves the app is a
 * public act, and offering it on something the author marked "only me" invites
 * a mistake that cannot be taken back.
 */
export function canShareExternally(post: { visibility: string; payload: PostPayload }): boolean {
  if (post.visibility === "private") return false;
  const kind = post.payload?.kind;
  return kind === "workout" || kind === "pr" || kind === "streak"
    || kind === "challenge_completed" || kind === "program";
}
