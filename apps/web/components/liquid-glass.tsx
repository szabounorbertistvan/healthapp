import type { CSSProperties, ElementType, ComponentPropsWithoutRef } from "react";

/**
 * Liquid Glass — the translucent material. The CSS lives in app/globals.css
 * (`.glass` and its modifiers, driven by the `--glass-*` tokens); this file
 * is the two ways of reaching it:
 *
 *   glass({ variant: "subtle", interactive: true })  → a class string, for
 *     the many existing <Link>/<button> elements whose className is already
 *     a string of utilities;
 *   <LiquidGlass as="button" variant="accent" interactive> … </LiquidGlass>
 *     → the element itself, with per-instance overrides (blur, tint…) written
 *     as CSS variables on the element so the tokens stay the single source.
 *
 * Variants: "glass" (cards, containers), "strong" (bars, sheets, popovers
 * over busy content), "subtle" (secondary controls), "accent" (the primary
 * button — opaque gold, built like glass), "interactive" (glass + hover /
 * pressed / focus states; `interactive` on any variant does the same).
 */
export type GlassVariant = "glass" | "strong" | "subtle" | "interactive" | "accent";

export type GlassOptions = {
  variant?: GlassVariant;
  /** Hover, pressed and focus-visible states. Implied by variant "interactive". */
  interactive?: boolean;
  /** Force the hover look (e.g. a "selected" chip). */
  hover?: boolean;
  /** Force the pressed look (e.g. a toggle that is on). */
  pressed?: boolean;
  disabled?: boolean;
  /** Set false to drop the outer shadow — flush surfaces, list rows. */
  shadow?: boolean;
  /** Set false to drop the 1px border ring and the rim light. */
  border?: boolean;
};

export type GlassTuning = {
  /** Multiplies the pane's opacity: 0.5 is half as milky, 2 twice. */
  intensity?: number;
  /** Any CSS colour; the pane is this colour at the variant's opacity. Default white. */
  tint?: string;
  /** Backdrop blur radius in px. */
  blur?: number;
  /** Backdrop saturation in %. */
  saturation?: number;
  /** Corner radius, any CSS length. */
  radius?: string;
};

/** The class string for one glass surface. Add your own utilities after it. */
export function glass({ variant = "glass", interactive, hover, pressed, disabled, shadow = true, border = true }: GlassOptions = {}): string {
  const parts = ["glass"];
  if (variant === "strong") parts.push("glass--strong");
  if (variant === "subtle") parts.push("glass--subtle");
  if (variant === "accent") parts.push("glass--accent");
  if (variant === "interactive" || interactive) parts.push("glass--interactive");
  if (hover) parts.push("glass--hover");
  if (pressed) parts.push("glass--pressed");
  if (disabled) parts.push("glass--disabled");
  if (!shadow) parts.push("[--glass-shadow:none] [--glass-shadow-pressed:none]");
  if (!border) parts.push("[--glass-border:transparent] before:hidden");
  return parts.join(" ");
}

/** Per-instance overrides as CSS variables — the tokens stay the source of truth. */
export function glassStyle({ intensity, tint, blur, saturation, radius }: GlassTuning): CSSProperties {
  const style: Record<string, string> = {};
  if (intensity !== undefined) style["--glass-intensity"] = String(intensity);
  if (tint) style["--glass-tint"] = tint;
  if (blur !== undefined) style["--glass-blur"] = `${blur}px`;
  if (saturation !== undefined) style["--glass-saturation"] = `${saturation}%`;
  if (radius) style["--glass-radius"] = radius;
  return style as CSSProperties;
}

type LiquidGlassProps<T extends ElementType> = GlassOptions &
  GlassTuning & {
    /** The element to render: div (default), button, a, nav, section… */
    as?: T;
    className?: string;
  } & Omit<ComponentPropsWithoutRef<T>, "as" | "className" | keyof GlassOptions | keyof GlassTuning>;

export function LiquidGlass<T extends ElementType = "div">({
  as,
  className = "",
  variant,
  interactive,
  hover,
  pressed,
  disabled,
  shadow,
  border,
  intensity,
  tint,
  blur,
  saturation,
  radius,
  style,
  ...rest
}: LiquidGlassProps<T> & { style?: CSSProperties }) {
  const Tag = (as ?? "div") as ElementType;
  const tuning = glassStyle({ intensity, tint, blur, saturation, radius });
  const isButton = Tag === "button";
  return (
    <Tag
      className={`${glass({ variant, interactive, hover, pressed, disabled, shadow, border })} ${className}`}
      style={{ ...tuning, ...style }}
      // A real button gets the real attribute; anything else announces it.
      {...(disabled ? (isButton ? { disabled: true } : { "aria-disabled": true }) : {})}
      {...rest}
    />
  );
}
