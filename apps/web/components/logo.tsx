import Image from "next/image";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

/**
 * Voinic brand mark — the gold "V" with the double-biceps figure, cut out of
 * the original logo PNG with a transparent background so it sits on both the
 * dark and the light theme. Source of truth: `public/brand/voinic-logo.png`
 * (full lockup) and `public/brand/voinic-mark.png` (mark only). The favicon in
 * `app/icon.png` and `app/apple-icon.png` are the same mark on a black tile.
 * The "VOINIC" lettering is also lifted from the logo (`voinic-wordmark.png`,
 * white on transparent) rather than set in a web font, so it matches exactly;
 * the light theme inverts it to black via `.brand-wordmark` in globals.css.
 * Server-safe (no hooks).
 *
 * `px` is the rendered size in CSS pixels and goes onto the <img> as its
 * width/height attributes, so the mark is already that size in the first
 * paint, before the stylesheet has arrived. The PNGs are 681px wide: with the
 * attributes at 681 a cold load showed the logo filling the screen for a
 * moment, then snapping to size when the classes applied. `sizes` keeps the
 * optimizer serving a retina-sharp candidate at that small rendered size.
 */
export function LogoMark({ className = "h-8 w-8", alt = "", px = 32 }: { className?: string; alt?: string; px?: number }) {
  return (
    <Image
      src="/brand/voinic-mark.png"
      alt={alt}
      width={px}
      height={px}
      sizes={`${px}px`}
      priority
      className={`${className} shrink-0 select-none object-contain`}
    />
  );
}

/** The wordmark PNG's aspect ratio (781 × 141). */
const WORDMARK_RATIO = 781 / 141;

/** The wordmark lettering from the logo. Size it with a height class; width follows. `px` is that height. */
export function Wordmark({ className = "h-4", alt = APP_NAME, px = 16 }: { className?: string; alt?: string; px?: number }) {
  const width = Math.round(px * WORDMARK_RATIO);
  return (
    <Image
      src="/brand/voinic-wordmark.png"
      alt={alt}
      width={width}
      height={px}
      sizes={`${width}px`}
      priority
      className={`brand-wordmark ${className} w-auto shrink-0 select-none`}
    />
  );
}

const SIZES = {
  sm: { mark: "h-8 w-8", markPx: 32, word: "h-[13px]", wordPx: 13, tag: "text-[9px]" },
  md: { mark: "h-9 w-9", markPx: 36, word: "h-4", wordPx: 16, tag: "text-[10px]" },
  lg: { mark: "h-12 w-12", markPx: 48, word: "h-5", wordPx: 20, tag: "text-[11px]" },
} as const;

/** Mark + wordmark lockup. `tagline` adds "Coach. Plan. Progress." underneath. */
export function Logo({
  size = "md",
  tagline = false,
  className = "",
}: {
  size?: keyof typeof SIZES;
  tagline?: boolean;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark className={s.mark} px={s.markPx} />
      <span className="flex flex-col items-start leading-none">
        <Wordmark className={s.word} px={s.wordPx} />
        {tagline ? (
          <span className={`mt-1 ${s.tag} font-display font-semibold uppercase tracking-[0.24em] text-accent-ink`}>{APP_TAGLINE}</span>
        ) : null}
      </span>
    </span>
  );
}
