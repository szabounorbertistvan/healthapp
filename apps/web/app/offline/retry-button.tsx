"use client";

/** Reloads the page the person was trying to open (the URL never changed to /offline). */
export function RetryButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="mt-5 inline-flex h-10 items-center rounded-2xl bg-accent px-4 font-display text-[13px] font-bold text-accent-fg hover:opacity-90"
    >
      {label}
    </button>
  );
}
