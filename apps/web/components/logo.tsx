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
 */
export function LogoMark({ className = "h-8 w-8", alt = "" }: { className?: string; alt?: string }) {
  return (
    <Image
      src="/brand/voinic-mark.png"
      alt={alt}
      width={681}
      height={681}
      priority
      className={`${className} shrink-0 select-none object-contain`}
    />
  );
}

/** The wordmark lettering from the logo. Size it with a height class; width follows. */
export function Wordmark({ className = "h-4", alt = APP_NAME }: { className?: string; alt?: string }) {
  return (
    <Image
      src="/brand/voinic-wordmark.png"
      alt={alt}
      width={781}
      height={141}
      priority
      className={`brand-wordmark ${className} w-auto shrink-0 select-none`}
    />
  );
}

const SIZES = {
  sm: { mark: "h-8 w-8", word: "h-[13px]", tag: "text-[9px]" },
  md: { mark: "h-9 w-9", word: "h-4", tag: "text-[10px]" },
  lg: { mark: "h-12 w-12", word: "h-5", tag: "text-[11px]" },
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
      <LogoMark className={s.mark} />
      <span className="flex flex-col items-start leading-none">
        <Wordmark className={s.word} />
        {tagline ? (
          <span className={`mt-1 ${s.tag} font-display font-semibold uppercase tracking-[0.24em] text-accent-ink`}>{APP_TAGLINE}</span>
        ) : null}
      </span>
    </span>
  );
}
