/**
 * The social surfaces' scale, in one place: the feed column, avatar and icon
 * sizes, the type ladder and the tap target. Class strings rather than new
 * @theme tokens — they are compositions of the palette in app/globals.css, not
 * new values, and a plain module so both server pages and "use client"
 * components can import them.
 *
 * Six text steps and no more. The name outranks everything around it; the
 * caption is the one line meant to be read, so it is the largest body size.
 */
export const SOCIAL = {
  /** The feed column: phone-wide on a phone, capped where a post stops reading as one thing. */
  column: "mx-auto w-full max-w-[500px]",
  /** Undo main's phone gutter so posts run edge to edge; back inside the column from `sm`. */
  bleed: "-mx-4 sm:mx-0",
  /** The phone gutter, matching main's px-4, for anything inside a bleed. */
  gutter: "px-4",

  avatar: {
    post: "h-9 w-9",
    story: "h-16 w-16",
    composer: "h-9 w-9",
  },
  /** Action-row icons. */
  icon: "h-[26px] w-[26px]",
  /** Icon-only button: 44px square, the minimum comfortable tap. */
  iconButton:
    "inline-flex h-11 w-11 items-center justify-center rounded-full transition-transform duration-150 active:scale-90 motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",

  text: {
    name: "text-[14px] font-semibold leading-tight",
    meta: "text-[12px] leading-tight text-ink-faint",
    caption: "text-[15px] leading-[1.45]",
    /** A post with no media: the words are the post. */
    body: "text-[17px] leading-[1.45]",
    secondary: "text-[13.5px] text-ink-soft",
    count: "text-[14px] font-semibold tabular-nums",
    time: "text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint",
  },
} as const;
