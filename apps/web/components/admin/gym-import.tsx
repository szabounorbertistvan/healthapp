"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cacheGymPhotos, importGoogleGyms, searchGoogleGyms, type GoogleGymHit } from "@/app/admin-gym-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

const FIELD = "mt-1 h-10 w-64 rounded-xl bg-bg px-3 text-[13.5px] text-ink outline-none ring-accent/50 focus:ring-2";

/**
 * "Import a city's gyms from Google": search, look at the list, untick what
 * is not a gym, import. Gyms already on our list are shown and cannot be
 * ticked; the database skips them anyway (admin_import_gyms).
 */
export function AdminGymImport() {
  const { t } = useI18n();
  const m = t.gyms.admin.import;
  const router = useRouter();
  const [city, setCity] = useState("");
  const [searched, setSearched] = useState("");
  const [hits, setHits] = useState<GoogleGymHit[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [stats, setStats] = useState<{ calls: number; capped: boolean } | null>(null);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function search(e: React.FormEvent) {
    e.preventDefault();
    setNote(null);
    start(async () => {
      const r = await searchGoogleGyms(city);
      if (!r.ok || !r.hits) {
        setHits(null);
        setNote(r.message === "GOOGLE_UNAVAILABLE" ? m.noKey : t.gyms.errors.generic);
        return;
      }
      setSearched(city.trim());
      setHits(r.hits);
      setStats({ calls: r.calls ?? 0, capped: Boolean(r.capped) });
      setPicked(new Set(r.hits.filter((h) => !h.known).map((h) => h.placeId)));
    });
  }

  function importPicked() {
    if (!hits) return;
    const places = hits.filter((h) => picked.has(h.placeId)).map((h) => h.raw);
    start(async () => {
      // Server Actions take at most 1 MB a call and a Google place object is
      // a few KB: a big city goes in batches, with progress shown.
      let imported = 0;
      let skipped = 0;
      for (let i = 0; i < places.length; i += 40) {
        setNote(fill(m.progress, { done: i, total: places.length }));
        const r = await importGoogleGyms(searched, places.slice(i, i + 40));
        if (!r.ok) {
          setNote(`${fill(m.done, { n: imported, s: skipped })} ${t.gyms.errors.generic}`);
          router.refresh();
          return;
        }
        imported += r.imported ?? 0;
        skipped += r.skipped ?? 0;
      }
      setNote(fill(m.done, { n: imported, s: skipped }));
      setHits((cur) => cur?.map((h) => (picked.has(h.placeId) ? { ...h, known: true } : h)) ?? null);
      setPicked(new Set());
      router.refresh();
      // New gyms come with a Google photo: copy them to Cloudinary right away.
      if (imported > 0) await copyPhotos();
    });
  }

  /** Copy every waiting Google photo into Cloudinary, ten a call, with progress. */
  async function copyPhotos() {
    let copied = 0;
    let failed = 0;
    for (let guard = 0; guard < 200; guard++) {
      const r = await cacheGymPhotos();
      if (!r.ok) {
        setPhotoNote(r.message === "CLOUDINARY_UNAVAILABLE" ? m.photosNoCloudinary : t.gyms.errors.generic);
        return;
      }
      copied += r.done ?? 0;
      failed += r.failed ?? 0;
      setPhotoNote(fill(m.photosProgress, { n: copied, f: failed, r: r.remaining ?? 0 }));
      if ((r.remaining ?? 0) === 0 || (r.done ?? 0) + (r.failed ?? 0) === 0) break;
    }
    setPhotoNote(fill(m.photosDone, { n: copied, f: failed }));
  }

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <div>
      <form onSubmit={search} className="flex flex-wrap items-end gap-2">
        <label className="block text-[12px] font-semibold text-ink-soft">
          {m.city}
          <input className={`${FIELD} block`} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Cluj-Napoca" required maxLength={80} />
        </label>
        <button type="submit" disabled={busy || !city.trim()} className="h-10 rounded-xl bg-accent px-4 text-[13px] font-bold text-accent-fg hover:opacity-90 disabled:opacity-50">
          {busy && !hits ? m.searching : m.search}
        </button>
      </form>
      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">{m.hint}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={() => start(copyPhotos)}
          className="h-9 rounded-xl bg-surface px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50">
          {m.photos}
        </button>
        {photoNote ? <span className="text-[12.5px] text-ink-soft">{photoNote}</span> : null}
      </div>
      {note ? <p className="mt-2 text-[12.5px] font-semibold text-accent-ink">{note}</p> : null}

      {stats?.capped ? <p className="mt-2 text-[12.5px] font-semibold text-warn">{m.capped}</p> : null}
      {hits ? (
        hits.length === 0 ? (
          <p className="mt-3 text-[13px] text-ink-faint">{m.none}</p>
        ) : (
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[12.5px] text-ink-soft">
                {fill(m.found, { n: hits.length, k: hits.filter((h) => h.known).length, city: searched })}
                {stats ? ` · ${fill(m.calls, { n: stats.calls })}` : null}
              </p>
              <button type="button" disabled={busy || picked.size === 0} onClick={importPicked}
                className="h-9 rounded-xl bg-accent px-4 text-[12.5px] font-bold text-accent-fg hover:opacity-90 disabled:opacity-50">
                {fill(m.importN, { n: picked.size })}
              </button>
            </div>
            <ul className="mt-2 grid max-h-[28rem] gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
              {hits.map((h) => (
                <li key={h.placeId}>
                  <label className={`flex items-start gap-2.5 rounded-xl px-3 py-2 ${h.known ? "bg-bg opacity-60" : "cursor-pointer bg-bg hover:bg-accent-soft/40"}`}>
                    <input type="checkbox" className="mt-1" disabled={h.known} checked={h.known || picked.has(h.placeId)} onChange={() => toggle(h.placeId)} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-semibold">{h.name}</span>
                      <span className="block truncate text-[11.5px] text-ink-faint">
                        {[h.rating != null ? `★ ${h.rating.toFixed(1)} (${h.ratingsTotal ?? 0})` : null, h.known ? m.known : null, h.address]
                          .filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : null}
    </div>
  );
}
