"use client";

/** The coach/client choice as two cards. Shared by the sign-up form and the
    complete-profile step, so the two places a role is picked look the same. */
export function RoleCard({
  selected, onSelect, title, body,
}: { selected: boolean; onSelect: () => void; title: string; body: string }) {
  return (
    <button
      type="button" onClick={onSelect} aria-pressed={selected}
      className={`rounded-lg border p-2.5 text-left transition-colors ${
        selected ? "border-accent bg-accent-soft" : "border-line bg-bg hover:border-ink-faint"
      }`}
    >
      <span className={`block text-sm font-semibold ${selected ? "text-accent-ink" : ""}`}>{title}</span>
      <span className="mt-0.5 block text-[11px] leading-snug text-ink-soft">{body}</span>
    </button>
  );
}
