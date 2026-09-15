import Image from "next/image";
import type { ExerciseType } from "@/lib/exercise-types";
import type { Sex } from "@/lib/types";

/**
 * Brand athletes — the two Voinic models, one full-length studio cutout per
 * exercise type and sex (`public/brand/athletes/by-sex/<type>-<m|f>.webp`,
 * Krea 2 renders cut out with BiRefNet, the same pose for both). Transparent
 * background, so the same file stands directly on either theme's surface —
 * nothing behind it, no box, no glow. Intrinsic sizes listed so `next/image`
 * can reserve the box. Decorative: the copy beside them carries the meaning,
 * so no alt text. Server-safe.
 */
export type AthleteSex = "m" | "f";

export const ATHLETES: Record<`${ExerciseType}-${AthleteSex}`, readonly [number, number]> = {
  "chest-m": [1021, 785], "chest-f": [1200, 698],
  "back-m": [745, 1200], "back-f": [718, 1200],
  "shoulders-m": [585, 1200], "shoulders-f": [548, 1200],
  "arms-m": [477, 1200], "arms-f": [449, 1200],
  "legs-m": [621, 1200], "legs-f": [636, 1200],
  "glutes-m": [582, 1200], "glutes-f": [489, 1200],
  "core-m": [1122, 765], "core-f": [1200, 826],
  "cardio-m": [668, 1200], "cardio-f": [649, 1200],
};

/**
 * Which model a user sees: their own sex when it is male or female; otherwise
 * a stable pick from `seed` (the day id), so the choice survives reloads and
 * matches between server and client render — Math.random() would not.
 */
export function athleteSex(sex: Sex | null | undefined, seed: string): AthleteSex {
  if (sex === "male") return "m";
  if (sex === "female") return "f";
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 2 === 0 ? "m" : "f";
}

type Props = {
  type: ExerciseType;
  /** The viewer's sex (users.sex); null / "other" picks by `seed`. */
  sex: Sex | null | undefined;
  /** Stable key for the pick when the sex does not decide — the day id. */
  seed: string;
  /** Classes for the <img>. Default fills the parent's height, whole figure kept, standing on the bottom edge, right-aligned. */
  className?: string;
  priority?: boolean;
  sizes?: string;
};

export function Athlete({ type, sex, seed, className = "h-full w-full object-contain object-right-bottom", priority = false, sizes }: Props) {
  const name = `${type}-${athleteSex(sex, seed)}` as const;
  const [width, height] = ATHLETES[name];
  return (
    <Image
      src={`/brand/athletes/by-sex/${name}.webp`}
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
