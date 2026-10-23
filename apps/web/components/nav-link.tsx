"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

/**
 * A sidebar / tab-bar link that prefetches on intent, not on sight.
 *
 * A plain `<Link>` prefetches as soon as it scrolls into view, and every
 * section of the app is dynamic: each prefetch renders the target's layout on
 * the server (profile, plan, onboarding marks, and on the training side the
 * notification feed), down to its loading.tsx. The coach sidebar alone fired
 * ten of those on every page load, of which one at most is ever used — the
 * soak suite measured 3–6 s each while they ran together (docs/PERFORMANCE.md).
 * Hover, keyboard focus or the start of a touch still buys the head start for
 * the link that is about to be clicked; `router.prefetch` is a no-op for a
 * route the router already holds.
 */
export function NavLink({ href, onMouseEnter, onFocus, onTouchStart, ...rest }: Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & { href: string }) {
  const router = useRouter();
  const warm = () => router.prefetch(href);
  return (
    <Link
      {...rest}
      href={href}
      prefetch={false}
      onMouseEnter={(e) => { warm(); onMouseEnter?.(e); }}
      onFocus={(e) => { warm(); onFocus?.(e); }}
      onTouchStart={(e) => { warm(); onTouchStart?.(e); }}
    />
  );
}
