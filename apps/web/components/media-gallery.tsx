"use client";
// The pictures of a post, the same everywhere a post is drawn — the feed, a
// profile, /saved, a share's embedded original, the post's own page.
//
// One picture is a PhotoFrame (with the overlay its author placed). Several
// are a carousel: native horizontal scroll-snap, so a thumb swipes and a
// trackpad scrolls without any gesture code; arrows on wider screens; ← / →
// when the carousel has focus; a quiet "2/4" and dots. The frame takes the
// first picture's shape (bounded 4:5 … 16:9) from its stored size, so the
// space is reserved before a byte loads and the feed never jumps; other
// shapes sit inside it whole, never cropped out of recognition.
//
// Only the pictures seen so far and the next one get an <img> — a ten-photo
// post costs two downloads until someone swipes. Every src is a short-lived
// /api/media link minted for this reader (lib/post-media-data.ts).
import { useRef, useState } from "react";
import { carouselLoaded, carouselStep, mediaFrameRatio } from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { PostMediaItem } from "@/lib/types";
import { NavIcon } from "./client-nav";
import { PhotoFrame } from "./photo-overlay";

const CHEVRON_LEFT = "M15 5l-7 7 7 7";
const CHEVRON_RIGHT = "M9 5l7 7-7 7";

export function MediaGallery({ items, authorName, splash, priority = false }: {
  items: PostMediaItem[];
  authorName: string;
  /** The double-tap layer the card mounts over every picture. */
  splash?: React.ReactNode;
  priority?: boolean;
}) {
  const { t } = useI18n();
  const s = t.common.social;
  if (items.length === 0) return null;
  const altOf = (item: PostMediaItem, i: number) =>
    item.alt ?? fill(s.mediaFallbackAlt, { n: i + 1, total: items.length, name: authorName });

  if (items.length === 1) {
    const one = items[0]!;
    return (
      <div className="mx-3 overflow-hidden rounded-2xl">
        <PhotoFrame src={one.url} width={one.width} height={one.height} overlay={one.overlay} stats={{}} alt={altOf(one, 0)} priority={priority}>
          {splash}
        </PhotoFrame>
      </div>
    );
  }
  return <Carousel items={items} authorName={authorName} altOf={altOf} splash={splash} priority={priority} />;
}

function Carousel({ items, authorName, altOf, splash, priority }: {
  items: PostMediaItem[];
  authorName: string;
  altOf: (item: PostMediaItem, i: number) => string;
  splash?: React.ReactNode;
  priority: boolean;
}) {
  const { t } = useI18n();
  const s = t.common.social;
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [maxSeen, setMaxSeen] = useState(0);
  const total = items.length;

  function go(delta: number) {
    const el = scroller.current;
    if (!el) return;
    const next = carouselStep(index, total, delta);
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: next * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
  }

  const arrow = "absolute top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-black/55 text-white transition-opacity hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-0 sm:grid";

  return (
    <div className="mx-3">
      <div
        role="region"
        aria-roledescription="carousel"
        aria-label={fill(s.mediaGallery, { name: authorName })}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
          else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
        }}
        className="relative overflow-hidden rounded-2xl bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        style={{ aspectRatio: mediaFrameRatio(items[0]) }}
      >
        <div
          ref={scroller}
          className="snap-frames no-scrollbar h-full"
          onScroll={(e) => {
            const el = e.currentTarget;
            const at = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
            if (at !== index) setIndex(at);
            if (at > maxSeen) setMaxSeen(at);
          }}
        >
          {items.map((item, i) => (
            <div
              key={item.id}
              role="group"
              aria-roledescription="slide"
              aria-label={fill(s.mediaSlide, { n: i + 1, total })}
              aria-hidden={i !== index ? true : undefined}
              className="relative h-full"
            >
              {carouselLoaded(i, maxSeen) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.url}
                  alt={altOf(item, i)}
                  width={item.width}
                  height={item.height}
                  loading={i === 0 && priority ? "eager" : "lazy"}
                  decoding="async"
                  draggable={false}
                  className="h-full w-full select-none object-contain"
                />
              ) : null}
              {splash}
            </div>
          ))}
        </div>

        <button type="button" onClick={() => go(-1)} disabled={index === 0} aria-label={s.mediaPrev} className={`${arrow} left-2`}>
          <NavIcon d={CHEVRON_LEFT} className="h-4 w-4 [stroke-width:2.4]" />
        </button>
        <button type="button" onClick={() => go(1)} disabled={index === total - 1} aria-label={s.mediaNext} className={`${arrow} right-2`}>
          <NavIcon d={CHEVRON_RIGHT} className="h-4 w-4 [stroke-width:2.4]" />
        </button>

        <span aria-hidden className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[11.5px] font-semibold tabular-nums text-white">
          {index + 1}/{total}
        </span>
        <span aria-live="polite" className="sr-only">{fill(s.mediaSlide, { n: index + 1, total })}</span>
      </div>
      <div aria-hidden className="mt-2 flex justify-center gap-1.5">
        {items.map((item, i) => (
          <span key={item.id} className={`h-1.5 w-1.5 rounded-full transition-colors ${i === index ? "bg-accent" : "bg-line"}`} />
        ))}
      </div>
    </div>
  );
}
