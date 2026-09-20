"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { NavIcon } from "@/components/client-nav";
import { NavSpinner } from "@/components/spinner";

export type AdminNavItem = { href: string; label: string; icon: string };

/** Exact for /admin, prefix for everything else, so Overview is not lit on every page. */
function isActive(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

/** Desktop sidebar list. Labels arrive from the server layout (dictionary). */
export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex h-9 items-center gap-3 rounded-xl px-3 text-[13.5px] ${
              active ? "bg-accent-soft font-semibold text-accent-ink" : "font-medium text-ink-soft hover:bg-surface hover:text-ink"
            }`}
          >
            <NavIcon d={item.icon} className="h-[17px] w-[17px]" />
            <span className="flex-1">{item.label}</span>
            <NavSpinner />
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Phone / tablet: a menu button in the header and a full-height sheet with
 * the same list. Same shape as the client "More" sheet — a sibling of the
 * glass header, never nested in it (its backdrop-filter would swallow ours).
 */
export function AdminMobileNav({ items, labels }: { items: AdminNavItem[]; labels: { menu: string; close: string } }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={labels.menu}
        aria-expanded={open}
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg glass glass--subtle glass--interactive text-ink-soft hover:text-ink lg:hidden"
      >
        <NavIcon d="M4 7h16M4 12h16M4 17h16" className="h-[18px] w-[18px]" />
      </button>
      {open
        ? createPortal(
            // Portalled to the body: the button sits inside the glass header,
            // whose backdrop-filter would otherwise be this sheet's containing
            // block (56px tall) and would swallow its own frost.
            <div className="fixed inset-0 z-40 lg:hidden">
              <button type="button" aria-label={labels.close} onClick={() => setOpen(false)} className="absolute inset-0 bg-bg/80" />
              <div role="dialog" aria-modal="true" aria-label={labels.menu} className="glass glass--strong absolute inset-y-3 left-3 w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto rounded-3xl p-3">
                <p className="mb-2 px-3 pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{labels.menu}</p>
                <AdminNav items={items} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
