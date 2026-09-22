"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ROUTINE_GOALS, ROUTINE_LEVELS, type RoutineFilter } from "@healthapp/shared";
import { useI18n } from "@/lib/i18n/client";
import { NavIcon } from "./client-nav";

/**
 * Search and filters for Discover.
 *
 * Everything lives in the URL rather than in component state: a filtered shelf
 * survives a refresh, can be linked to, and the back button does what it looks
 * like it does. The page reads the same parameters server-side, so the list is
 * rendered filtered rather than filtered after it arrives.
 */
export function RoutineFilters({
  filter,
  muscles,
  equipment,
}: {
  filter: RoutineFilter;
  muscles: string[];
  equipment: string[];
}) {
  const { t } = useI18n();
  const r = t.clientApp.routines;
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(filter.q ?? "");

  // Debounced: typing is faster than a round trip, and every keystroke would
  // otherwise push a history entry.
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (q === current) return;
    const timer = setTimeout(() => push({ q, page: null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function push(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    // Any change to what is being asked for starts again at page one.
    if (!("page" in patch)) next.delete("page");
    router.push(`/routines?${next.toString()}`);
  }

  const active = Boolean(filter.q || filter.level || filter.goal || filter.muscle || filter.equipment);

  return (
    <div className="mt-4 space-y-2.5">
      <label className="flex h-11 items-center gap-2.5 rounded-2xl bg-surface px-3.5 text-ink-faint">
        <NavIcon d="m20 20-3.5-3.5M13 6a7 7 0 1 1-9.9 9.9A7 7 0 0 1 13 6z" className="h-4 w-4 shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={r.search}
          aria-label={r.search}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
        />
      </label>

      {/* Scrolls sideways on a phone rather than wrapping into four rows and
          pushing the shelf off the screen. */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <Select
          label={r.allLevels}
          value={filter.level ?? ""}
          options={ROUTINE_LEVELS.map((l) => ({ value: l, label: r.level[l] }))}
          onChange={(v) => push({ level: v })}
        />
        <Select
          label={r.allGoals}
          value={filter.goal ?? ""}
          options={ROUTINE_GOALS.map((g) => ({ value: g, label: r.goal[g] }))}
          onChange={(v) => push({ goal: v })}
        />
        <Select
          label={r.allMuscles}
          value={filter.muscle ?? ""}
          options={muscles.map((m) => ({ value: m, label: m }))}
          onChange={(v) => push({ muscle: v })}
        />
        <Select
          label={r.allEquipment}
          value={filter.equipment ?? ""}
          options={equipment.map((e) => ({ value: e, label: e }))}
          onChange={(v) => push({ equipment: v })}
        />
        <Select
          label={r.sortNewest}
          value={filter.sort === "most_copied" ? "most_copied" : ""}
          options={[{ value: "most_copied", label: r.sortMostCopied }]}
          onChange={(v) => push({ sort: v })}
        />
        {active ? (
          <button
            type="button"
            onClick={() => router.push("/routines?tab=discover")}
            className="inline-flex h-10 shrink-0 items-center rounded-full px-3 text-[12.5px] font-semibold text-ink-faint hover:text-ink"
          >
            {r.clear}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
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
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
