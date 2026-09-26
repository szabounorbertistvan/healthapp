"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CHALLENGE_CATEGORIES, CHALLENGE_DIFFICULTIES, type ChallengeFilter } from "@healthapp/shared";
import { useI18n } from "@/lib/i18n/client";
import { NavIcon } from "./client-nav";

/**
 * Search and filters for the challenge list. Everything lives in the URL, as
 * on Discover: a filtered list survives a refresh and the back button, and the
 * page filters server-side (matchesChallengeFilter) rather than after load.
 */
export function ChallengeFilters({ filter }: { filter: ChallengeFilter }) {
  const { t } = useI18n();
  const ch = t.common.challenges;
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(filter.q ?? "");

  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const timer = setTimeout(() => push({ q }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function push(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    const s = next.toString();
    router.push(s ? `/challenges?${s}` : "/challenges");
  }

  const active = Boolean(filter.q || filter.status || filter.category || filter.difficulty || filter.duration);

  return (
    <div className="mt-4 space-y-2.5">
      <label className="flex h-11 items-center gap-2.5 rounded-2xl bg-surface px-3.5 text-ink-faint">
        <NavIcon d="m20 20-3.5-3.5M13 6a7 7 0 1 1-9.9 9.9A7 7 0 0 1 13 6z" className="h-4 w-4 shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={ch.search}
          aria-label={ch.search}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
        />
      </label>
      {/* Sideways on a phone rather than four wrapped rows above the list. */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        <Select label={ch.allStatuses} value={filter.status ?? ""} onChange={(v) => push({ status: v })}
          options={(["active", "upcoming", "completed"] as const).map((s) => ({ value: s, label: ch.statusFilter[s] }))} />
        <Select label={ch.allCategories} value={filter.category ?? ""} onChange={(v) => push({ category: v })}
          options={CHALLENGE_CATEGORIES.map((c) => ({ value: c, label: ch.category[c] }))} />
        <Select label={ch.allDifficulties} value={filter.difficulty ?? ""} onChange={(v) => push({ difficulty: v })}
          options={CHALLENGE_DIFFICULTIES.map((d) => ({ value: d, label: ch.difficulty[d] }))} />
        <Select label={ch.anyDuration} value={filter.duration ?? ""} onChange={(v) => push({ duration: v })}
          options={(["week", "month", "long"] as const).map((d) => ({ value: d, label: ch.duration[d] }))} />
        {active ? (
          <button
            type="button"
            onClick={() => router.push("/challenges")}
            className="inline-flex h-10 shrink-0 items-center rounded-full px-3 text-[12.5px] font-semibold text-ink-faint hover:text-ink"
          >
            {ch.clearFilters}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Select({
  label, value, options, onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className={`h-10 shrink-0 rounded-full px-3.5 text-[12.5px] font-semibold outline-none ${
        value ? "bg-accent-soft text-accent-ink" : "bg-surface text-ink-soft"
      }`}
    >
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
