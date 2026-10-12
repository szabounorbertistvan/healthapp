import Link from "next/link";
import { getGymsMap, getMyGyms } from "@/lib/gym-data";
import { GymMapLoader } from "@/components/gym-stats";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

/**
 * /gyms — the gym map (MapLibre, every active gym with coordinates) and the
 * list under it; each gym's page carries its records and stats. The
 * gym-vs-gym tops are admin-only for now (/admin/gyms, 20261117110000).
 */
export default async function GymsPage() {
  const { t } = await getI18n();
  const h = t.gyms.hub;
  const [pins, my] = await Promise.all([getGymsMap(), getMyGyms()]);

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
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{h.list}</h2>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {pins.map((p) => (
                <li key={p.id}>
                  <Link href={`/gyms/${p.id}`} className="block rounded-2xl bg-surface px-4 py-3 hover:bg-accent-soft/40">
                    <span className="block truncate text-[14px] font-semibold">{p.name}</span>
                    <span className="block truncate text-[12.5px] text-ink-faint">
                      {[p.city, fill(h.members, { n: p.members }), p.coaches > 0 ? fill(h.coaches, { n: p.coaches }) : null].filter(Boolean).join(" · ")}
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
