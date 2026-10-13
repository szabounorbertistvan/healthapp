import Link from "next/link";
import { getGymsMap, getMyGyms } from "@/lib/gym-data";
import { GymMapLoader } from "@/components/gym-stats";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { getProfile } from "@/lib/data";

/**
 * /gyms — the gym map (MapLibre, every active gym with coordinates) and the
 * list under it; each gym's page carries its records and stats. The
 * gym-vs-gym tops are admin-only for now (/admin/gyms, 20261117110000).
 */
export default async function GymsPage() {
  const { t } = await getI18n();
  const h = t.gyms.hub;
  const [pins, my, profile] = await Promise.all([getGymsMap(), getMyGyms(), getProfile()]);
  // The list under the map: the reader's own town (their gym's, else their
  // profile's), best rated first — the map carries the other 800-odd.
  const norm = (v: string | null | undefined) => (v ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  const town = my.home?.city ?? profile?.city ?? null;
  const local = town ? pins.filter((p) => norm(p.city) === norm(town)) : [];
  const listed = (local.length > 0 ? local : pins)
    .slice()
    .sort((a, b) => (b.google_rating ?? 0) - (a.google_rating ?? 0) || a.name.localeCompare(b.name))
    .slice(0, 60);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{h.title}</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-ink-soft">{h.intro}</p>
        </div>
        {my.home ? (
          <Link href={`/gyms/${my.home.id}#records`} className="inline-flex h-9 items-center rounded-full bg-accent px-4 text-[12.5px] font-bold text-accent-fg hover:opacity-90">
            {fill(t.gyms.records.myRecords, { gym: my.home.name })}
          </Link>
        ) : null}
      </div>

      <div className="mt-4">
        <GymMapLoader pins={pins} homeGymId={my.home?.id ?? null} />
        {pins.length > 0 ? (
          <section className="mt-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {local.length > 0 ? fill(h.listIn, { city: local[0].city }) : h.listTop}
            </h2>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {listed.map((p) => (
                <li key={p.id}>
                  <Link href={`/gyms/${p.id}`} className="block rounded-2xl bg-surface px-4 py-3 hover:bg-accent-soft/40">
                    <span className="block truncate text-[14px] font-semibold">{p.name}</span>
                    <span className="block truncate text-[12.5px] text-ink-faint">
                      {[p.google_rating != null ? `★ ${p.google_rating.toFixed(1)}` : null, p.city, p.members > 0 ? fill(h.members, { n: p.members }) : null, p.coaches > 0 ? fill(h.coaches, { n: p.coaches }) : null].filter(Boolean).join(" · ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
