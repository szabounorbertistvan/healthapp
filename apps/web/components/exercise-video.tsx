"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { youtubeEmbedUrl, type ExerciseVideoSource } from "@healthapp/shared";
import { setExerciseVideo } from "@/app/library-actions";
import { useI18n } from "@/lib/i18n/client";

/**
 * An exercise's demo video, and the field anyone can use to pin their own
 * YouTube link to it — library rows included. What arrives here is already
 * resolved (pickExerciseVideo: yours, else your coach's, else the row's);
 * `source` says which, so a coach's pick reads as theirs and "remove" only
 * appears on a link that is yours to remove.
 *
 * The src always goes back through youtubeEmbedUrl, never straight from the
 * prop, so a value that somehow holds a foreign URL renders nothing instead
 * of framing it.
 *
 * `collapsed` is the set logger's shape: a one-line toggle, so a list of
 * exercises does not turn into a list of video players.
 */
export function ExerciseVideo({
  exerciseId,
  videoUrl,
  source,
  mine = false,
  collapsed = false,
}: {
  exerciseId: string;
  videoUrl: string | null | undefined;
  source: ExerciseVideoSource | null | undefined;
  /** A custom exercise the viewer owns: its row-level video is theirs to clear. */
  mine?: boolean;
  collapsed?: boolean;
}) {
  const { t } = useI18n();
  const v = t.common.exerciseVideo;
  const router = useRouter();
  const [saved, setSaved] = useState(videoUrl ?? "");
  const [savedSource, setSavedSource] = useState<ExerciseVideoSource | null>(videoUrl ? (source ?? null) : null);
  const ownedSource = (src: ExerciseVideoSource | null) => src === "own" || (mine && src === "exercise");
  const [url, setUrl] = useState(ownedSource(savedSource) ? saved : "");
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(!collapsed);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const embed = youtubeEmbedUrl(saved);
  // Yours to change or remove: a link you pinned, or the row video of your own custom exercise.
  const removable = ownedSource(savedSource);

  // A save ends in router.refresh(); take the re-resolved answer when it lands
  // (clearing your own link can uncover your coach's).
  useEffect(() => {
    setSaved(videoUrl ?? "");
    setSavedSource(videoUrl ? (source ?? null) : null);
  }, [videoUrl, source]);

  function save(next: string) {
    setError(null);
    start(async () => {
      const result = await setExerciseVideo(exerciseId, next);
      if (!result.ok) {
        setError(result.message ?? v.invalid);
        return;
      }
      // Optimistic until the refresh brings back the resolved answer. On your
      // own custom exercise the action writes the row, everywhere else a link.
      setSaved(next);
      setSavedSource(next ? (mine ? "exercise" : "own") : null);
      setUrl(next);
      setEditing(false);
      if (next) setOpen(true);
      router.refresh();
    });
  }

  if (collapsed && !open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          if (!embed) setEditing(true);
        }}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent-ink hover:underline"
      >
        <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5 fill-current">
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
        {embed ? v.watch : v.add}
      </button>
    );
  }

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        {v.title}
        {embed && savedSource === "coach" ? ` · ${v.fromCoach}` : ""}
      </p>
      {embed ? (
        <div className="mt-2 aspect-video overflow-hidden rounded-2xl bg-bg">
          <iframe
            src={embed}
            title={v.frameTitle}
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="h-full w-full border-0"
          />
        </div>
      ) : null}

      {editing ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={v.placeholder}
            autoFocus
            className="h-10 min-w-0 flex-1 rounded-2xl bg-bg px-3.5 text-[13.5px] text-ink outline-none ring-accent/50 focus:ring-2"
          />
          <button
            type="button"
            disabled={pending || !url.trim()}
            onClick={() => save(url)}
            className="inline-flex h-10 items-center rounded-2xl bg-accent px-4 font-display text-[13px] font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {v.save}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
              if (collapsed && !embed) setOpen(false);
            }}
            className="text-[12.5px] font-semibold text-ink-faint hover:text-ink"
          >
            {t.common.actions.cancel}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[12.5px] font-semibold text-accent-ink hover:underline"
          >
            {embed ? (removable ? v.change : v.useOwn) : v.add}
          </button>
          {removable ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => save("")}
              className="text-[12.5px] font-semibold text-ink-faint hover:text-ink"
            >
              {v.remove}
            </button>
          ) : null}
          {collapsed ? (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[12.5px] font-semibold text-ink-faint hover:text-ink"
            >
              {v.hide}
            </button>
          ) : null}
        </div>
      )}
      {error ? <p className="mt-1.5 text-[12.5px] text-risk">{error}</p> : null}
    </div>
  );
}
