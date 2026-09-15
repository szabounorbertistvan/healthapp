import Image from "next/image";
import type { ExerciseType } from "@/lib/exercise-types";

/**
 * Brand athletes — the two Voinic models (him / her), full-length studio
 * cutouts with a transparent background (`public/brand/athletes/<name>.webp`,
 * Krea 2 renders cut out with BiRefNet). No background of their own, so the
 * same file stands directly on either theme's surface — nothing behind them,
 * no box, no glow. Sizes listed here so `next/image` can reserve the box.
 * Decorative: the copy beside them carries the meaning, so no alt text.
 * Server-safe.
 */
export const ATHLETES = {
  chest: [1021, 785],
  back: [745, 1200],
  shoulders: [548, 1200],
  arms: [477, 1200],
  legs: [636, 1200],
  glutes: [489, 1200],
  core: [1200, 826],
  cardio: [668, 1200],
  hero: [597, 1200],
  client: [430, 1200],
  coach: [699, 1200],
} as const satisfies Record<ExerciseType | "hero" | "client" | "coach", readonly [number, number]>;
export type AthleteName = keyof typeof ATHLETES;

type Props = {
  name: AthleteName;
  /** Classes for the <img>. Default fills the parent's height, whole figure kept, standing on the bottom edge, right-aligned. */
  className?: string;
  priority?: boolean;
  sizes?: string;
};

export function Athlete({ name, className = "h-full w-full object-contain object-right-bottom", priority = false, sizes }: Props) {
  const [width, height] = ATHLETES[name];
  return (
    <Image
      src={`/brand/athletes/${name}.webp`}
      alt=""
      aria-hidden
      width={width}
      height={height}
      priority={priority}
      sizes={sizes}
      className={`select-none ${className}`}
    />
  );
}
