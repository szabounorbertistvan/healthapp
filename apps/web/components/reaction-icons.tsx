import type { ReactionType } from "@healthapp/shared";

/**
 * The two reactions, served as our own image files rather than typed as
 * emoji: 💪 and 🍑 render as different pictures on Windows, Android and iOS,
 * and a reaction row that looks different on every phone is not one design.
 *
 * Both pictures were supplied by relu and cut out of their white background
 * into transparent 256px PNGs (public/reactions/); a 26px icon on a 3× screen
 * needs 78px, so that is plenty. They are <img>s: one file, cached once,
 * identical on every device.
 *
 * `muted` is the not-yet-pressed look: the same picture, desaturated, so the
 * pressed state is the colour arriving rather than a different icon.
 */
const SRC: Record<ReactionType, string> = { kudos: "/reactions/biceps.png", love: "/reactions/peach.png" };

export function ReactionIcon({ type, className = "h-6 w-6", muted = false }: { type: ReactionType; className?: string; muted?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={SRC[type]}
      alt=""
      aria-hidden
      draggable={false}
      decoding="async"
      className={`${className} shrink-0 select-none object-contain ${muted ? "[filter:grayscale(1)_opacity(.55)]" : ""}`}
    />
  );
}
