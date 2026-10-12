"use client";
import { useId, useMemo, useState } from "react";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { FIELD } from "@/lib/form-classes";
import { filterTaxonomy, groupSpecializations, specializationName, type TaxonomyEntry } from "@/lib/coach-taxonomy";
import { Chip } from "./ui";

/** Past this many entries a search box earns its place above the groups. */
const SEARCH_FROM = 14;

/**
 * The specialization taxonomy as grouped chips: one heading per group, a
 * discipline's styles right after it, set in from the edge. Shared by the
 * coach's own editor (state) and the directory filter (the URL) — the caller
 * owns what a toggle does. A selected entry is never hidden by the search, so
 * nobody loses sight of what they picked.
 */
export function SpecializationChips<T extends TaxonomyEntry>({
  entries, isOn, onToggle, label, badge, testId,
}: {
  entries: readonly T[];
  isOn: (slug: string) => boolean;
  onToggle: (slug: string) => void;
  /** The chip's text; defaults to the label in the reader's language. */
  label?: (entry: T) => React.ReactNode;
  /** Something after the label, e.g. a count. */
  badge?: (entry: T) => React.ReactNode;
  testId?: string;
}) {
  const { t, locale } = useI18n();
  const x = t.coachProfile.taxonomy;
  const ids = useId();
  const [query, setQuery] = useState("");
  const matched = useMemo(() => filterTaxonomy(entries, query), [entries, query]);
  const shown = useMemo(() => {
    const kept = new Set(matched.map((e) => e.slug));
    return entries.filter((e) => kept.has(e.slug) || isOn(e.slug));
  }, [entries, matched, isOn]);
  const groups = useMemo(() => groupSpecializations(shown), [shown]);

  const chip = (e: T) => (
    <Chip key={e.slug} on={isOn(e.slug)} onToggle={() => onToggle(e.slug)}>
      {label ? label(e) : specializationName(e, locale)}
      {badge ? badge(e) : null}
    </Chip>
  );

  return (
    <div data-testid={testId}>
      {entries.length >= SEARCH_FROM ? (
        <div className="relative mt-2">
          <label htmlFor={`${ids}-q`} className="sr-only">{x.searchLabel}</label>
          <input
            id={`${ids}-q`} type="search" value={query} onChange={(ev) => setQuery(ev.target.value)}
            placeholder={x.searchPlaceholder} autoComplete="off" className={FIELD} data-testid={testId ? `${testId}-search` : undefined}
          />
        </div>
      ) : null}
      {/* "nothing matches" is about the search, even while a picked chip stays on screen */}
      {matched.length === 0 && query.trim() ? (
        <p className="mt-3 text-[13px] text-ink-faint" role="status">
          {fill(x.noMatch, { q: query })}{" "}
          <button type="button" onClick={() => setQuery("")} className="font-semibold text-accent-ink hover:underline">{x.clearSearch}</button>
        </p>
      ) : null}
      <div className="mt-3 grid gap-4">
        {groups.map((g) => (
          <div key={g.category} role="group" aria-labelledby={`${ids}-${g.category}`} data-category={g.category}>
            <p id={`${ids}-${g.category}`} className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-ink-faint">
              {x.groups[g.category]}
            </p>
            {g.items.some((i) => i.styles.length === 0) ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {g.items.filter((i) => i.styles.length === 0).map((i) => chip(i.entry))}
              </div>
            ) : null}
            {g.items.filter((i) => i.styles.length > 0).map((i) => (
              <div key={i.entry.slug} className="mt-2">
                {chip(i.entry)}
                {/* the styles of that discipline, set in under it: a narrow column wraps them, never strands them */}
                <div className="ml-3 mt-1.5 flex flex-wrap gap-1.5 border-l border-line pl-2.5">{i.styles.map(chip)}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
