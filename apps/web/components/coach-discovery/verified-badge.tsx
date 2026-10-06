"use client";
import { useI18n } from "@/lib/i18n/client";

/**
 * "Voinic Verified": the one trust badge, drawn only from real state — the
 * coach-level verification an admin decided (coach_profiles.verification_status
 * = 'verified', 20261101100000), as the search card (`verified`) and the
 * public profile (`verified`) report it. Nothing else earns it: not a complete
 * profile, not a credential the coach typed in. Renders nothing otherwise.
 *
 *   sm — the icon alone, beside a name in a list (the label is still read out);
 *   md — the icon and the label, on the profile.
 */
export function VerifiedBadge({ verified, size = "sm", className = "" }: {
  verified: boolean | null | undefined;
  size?: "sm" | "md";
  className?: string;
}) {
  const { t } = useI18n();
  const v = t.coachProfile.verification;
  if (!verified) return null;
  const icon = (
    <svg viewBox="0 0 24 24" aria-hidden className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} fill="none" stroke="currentColor"
      strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v5c0 4.6-3 8.3-7 10-4-1.7-7-5.4-7-10V6z" fill="currentColor" stroke="none" opacity={0.25} />
      <path d="M8.5 12.2l2.4 2.4 4.6-4.9" />
    </svg>
  );
  return (
    <span
      data-testid="voinic-verified"
      title={v.badgeHint}
      className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-full bg-accent font-semibold text-accent-fg ${
        size === "sm" ? "h-[18px] w-[18px]" : "h-7 px-2.5 text-[12px]"} ${className}`}
    >
      {icon}
      {size === "md" ? <span>{v.badge}</span> : <span className="sr-only">{v.badge}</span>}
    </span>
  );
}
