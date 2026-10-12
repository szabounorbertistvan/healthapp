"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { searchGyms, setSessionGym } from "@/app/gym-actions";
import type { GymHit, GymRef } from "@/lib/gym-data";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { SuggestGym } from "./gyms";
import { Card } from "./ui";

const CHIP =
  "inline-flex h-9 items-center rounded-full bg-bg px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50";

/**
 * "Where did you train?" on the workout-done screen. Optional, one tap: the
 * person's own gym and the gyms they used lately as chips, a search for any
 * other listed gym, and a way to suggest a missing one (it waits for an
 * admin, so it cannot be picked yet). The answer feeds the gym's tops and
 * stats — counts behind a three-people floor, never a name.
 */
export function SessionGymPicker({ sessionId, current, home, recent }: {
  sessionId: string;
  current: GymRef | null;
  home: GymRef | null;
  recent: GymRef[];
}) {
  const { t } = useI18n();
  const m = t.gyms.session;
  const router = useRouter();
  const [chosen, setChosen] = useState<GymRef | null>(current);
  const [editing, setEditing] = useState(!current);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GymHit[]>([]);
  const [error, setError] = useState(false);
  const [busy, start] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    if (!searching) return;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      const found = await searchGyms(query);
      if (mine === seq.current) setHits(found.filter((h) => h.status === "active").slice(0, 6));
    }, query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [query, searching]);

  function pick(g: GymRef | null) {
    setError(false);
    start(async () => {
      const r = await setSessionGym(sessionId, g?.id ?? null);
      if (!r.ok) { setError(true); return; }
      setChosen(g);
      setEditing(false);
      setSearching(false);
      router.refresh();
    });
  }

  // Home first, then recent ones that are not home — no gym twice.
  const shortcuts = [home, ...recent.filter((r) => r.id !== home?.id)].filter(Boolean).slice(0, 4) as GymRef[];

  return (
    <Card plain>
      <p className="font-display text-[17px] font-bold tracking-tight">{m.title}</p>
      {!editing && chosen ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-semibold text-accent-ink">{fill(m.saved, { gym: chosen.name })}</span>
          <button type="button" className={CHIP} onClick={() => setEditing(true)}>{m.change}</button>
        </div>
      ) : (
        <>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-faint">{m.hint}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {shortcuts.map((g) => (
              <button key={g.id} type="button" disabled={busy} onClick={() => pick(g)}
                className={`${CHIP} ${g.id === chosen?.id ? "!bg-accent-soft !text-accent-ink" : ""}`}>
                {g.id === home?.id ? `${m.home}: ` : ""}{g.name}
              </button>
            ))}
            <button type="button" className={CHIP} onClick={() => setSearching((v) => !v)}>{m.other}</button>
            {chosen ? <button type="button" disabled={busy} className={CHIP} onClick={() => pick(null)}>{m.clear}</button> : null}
          </div>
          {searching ? (
            <div className="mt-3">
              <input
                type="search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={m.search}
                aria-label={m.search}
                className="h-11 w-full rounded-2xl bg-bg px-3.5 text-[14px] text-ink outline-none ring-accent/50 focus:ring-2"
              />
              {hits.length > 0 ? (
                <ul className="mt-2 grid gap-1.5">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button type="button" disabled={busy} onClick={() => pick({ id: h.id, name: h.name, city: h.city })}
                        className="w-full rounded-2xl bg-bg px-3.5 py-2.5 text-left hover:bg-accent-soft/40">
                        <span className="block text-[14px] font-semibold">{h.name}</span>
                        <span className="block text-[12.5px] text-ink-faint">{[h.address, h.city].filter(Boolean).join(", ")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {/* A missing gym waits for an admin; once approved it can be picked here. */}
              <SuggestGym pending={[]} />
            </div>
          ) : null}
          {error ? <p className="mt-2 text-[12.5px] text-risk">{t.gyms.errors.generic}</p> : null}
        </>
      )}
    </Card>
  );
}
