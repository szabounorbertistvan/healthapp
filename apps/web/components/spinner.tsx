"use client";
import { useLinkStatus } from "next/link";
import { useI18n } from "@/lib/i18n/client";

/**
 * The one spinner shape, in two sizes.
 *
 * A ring with one transparent quarter, spun — it inherits `currentColor`, so
 * it takes the colour of whatever it sits in rather than needing a variant per
 * surface.
 */
function Ring({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block shrink-0 animate-spin rounded-full border-current border-r-transparent ${className}`}
      aria-hidden="true"
    />
  );
}

/**
 * A spinner for the link the person just tapped.
 *
 * `useLinkStatus` reports the pending state of the nearest enclosing <Link>,
 * so this only works as a *child* of that link — it cannot be hoisted into the
 * nav and handed an href.
 *
 * This answers "did my tap register", which the page spinner below cannot: on
 * the phone tab bar the thumb is nowhere near the content area.
 */
export function NavSpinner({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <Ring className={`h-3 w-3 border-2 opacity-70 ${className}`} />;
}

/**
 * What a route shows while its data is in flight, via the `loading.tsx` in
 * each route group.
 *
 * A client component on purpose: a `loading.tsx` becomes a Suspense fallback,
 * and on a client-side navigation the fallback has to be paintable the instant
 * the link is clicked — that is the whole point of it. An async server
 * component would put a server round trip in front of the thing whose job is
 * to cover a server round trip.
 *
 * Sits high rather than dead-centre: these screens are read from the top, and
 * a spinner pinned to the middle of a tall viewport reads as unrelated to the
 * content that replaces it.
 */
export function PageSpinner() {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-accent-ink"
    >
      <Ring className="h-8 w-8 border-[3px]" />
      <span className="text-xs font-semibold text-ink-faint">{t.common.actions.loading}</span>
    </div>
  );
}
