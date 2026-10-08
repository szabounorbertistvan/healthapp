"use client";
import { useState } from "react";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { trackMarketplace } from "../marketplace-tracker";
import { NavIcon } from "../client-nav";

/**
 * Share a coach's page: the phone's own share sheet where there is one
 * (Instagram, WhatsApp, TikTok… all read the page's Open Graph tags), else
 * the canonical link copied. Counted as `share` (native | copy) — the URL is
 * the canonical one, nothing about the reader is added to it.
 */
export function ShareCoachButton({ url, name, slug, className = "" }: { url: string; name: string; slug: string; className?: string }) {
  const { t } = useI18n();
  const p = t.coachProfile.publicPage;
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function share() {
    const text = fill(p.shareText, { name });
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: text, text, url });
        trackMarketplace("share", { slug, detail: "native" });
        return;
      }
      await navigator.clipboard.writeText(url);
      setState("copied");
      trackMarketplace("share", { slug, detail: "copy" });
      setTimeout(() => setState("idle"), 2500);
    } catch (e) {
      // closing the share sheet is not a failure
      if (e instanceof DOMException && e.name === "AbortError") return;
      setState("failed");
    }
  }

  return (
    <span className="relative inline-flex">
      <button type="button" onClick={share} data-testid="share-coach"
        className={`inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-surface px-4 text-[14px] font-semibold text-ink hover:bg-accent-soft/60 ${className}`}>
        <NavIcon d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" className="h-4 w-4" />
        {p.share}
      </button>
      <span role="status" aria-live="polite" className={state === "idle" ? "sr-only" : "absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-3 py-1 text-[12px] font-semibold text-bg"}>
        {state === "copied" ? p.shareCopied : state === "failed" ? p.shareFailed : ""}
      </span>
    </span>
  );
}
