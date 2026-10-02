"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { readMapsLink, saveGym, type GymInput } from "@/app/admin-gym-actions";
import { useI18n } from "@/lib/i18n/client";
import type { GymErrorCode } from "@/lib/i18n/messages/gyms";

const FIELD = "mt-1 h-10 w-full rounded-xl bg-bg px-3 text-[13.5px] text-ink outline-none ring-accent/50 focus:ring-2";
const LABEL = "block text-[12px] font-semibold text-ink-soft";

export type AdminGymValues = {
  id: string;
  name: string;
  city: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  maps_url: string | null;
};

/**
 * Create or edit a gym. A pasted Google Maps link can prefill the name and
 * the pin ("Fill from link"); the admin sees both before saving. The link
 * itself is kept for the "open in maps" button.
 */
export function AdminGymForm({ gym, onDone }: { gym?: AdminGymValues; onDone?: () => void }) {
  const { t } = useI18n();
  const f = t.gyms.admin.form;
  const errors = t.gyms.errors;
  const router = useRouter();
  const [v, setV] = useState<GymInput>({
    name: gym?.name ?? "",
    city: gym?.city ?? "",
    address: gym?.address ?? "",
    lat: gym?.lat != null ? String(gym.lat) : "",
    lng: gym?.lng != null ? String(gym.lng) : "",
    mapsUrl: gym?.maps_url ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: keyof GymInput) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  const messageOf = (m?: string) => {
    const code = (Object.keys(errors) as (GymErrorCode | "generic")[]).find((k) => k !== "generic" && m?.includes(k));
    return code ? errors[code] : m ?? errors.generic;
  };

  function fill() {
    setError(null);
    start(async () => {
      const r = await readMapsLink(v.mapsUrl);
      if (!r.ok || !r.facts) {
        setError(errors.LINK);
        return;
      }
      const facts = r.facts;
      setV((cur) => ({
        ...cur,
        name: cur.name || facts.name || "",
        lat: facts.lat != null ? String(facts.lat) : cur.lat,
        lng: facts.lng != null ? String(facts.lng) : cur.lng,
      }));
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await saveGym(gym?.id ?? null, v);
      if (!r.ok) {
        setError(messageOf(r.message));
        return;
      }
      if (!gym) setV({ name: "", city: "", address: "", lat: "", lng: "", mapsUrl: "" });
      onDone?.();
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div>
        <label className={LABEL}>
          {f.link}
          <div className="flex gap-2">
            <input className={FIELD} value={v.mapsUrl} onChange={set("mapsUrl")} inputMode="url" placeholder="https://maps.app.goo.gl/…" maxLength={500} />
            <button type="button" disabled={busy || !v.mapsUrl.trim()} onClick={fill} className="mt-1 h-10 shrink-0 rounded-xl bg-surface px-3 text-[12.5px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50">
              {f.fill}
            </button>
          </div>
        </label>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">{f.linkHint}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={LABEL}>{f.name}<input className={FIELD} value={v.name} onChange={set("name")} required maxLength={120} /></label>
        <label className={LABEL}>{f.city}<input className={FIELD} value={v.city} onChange={set("city")} required maxLength={80} /></label>
        <label className={`${LABEL} sm:col-span-2`}>{f.address}<input className={FIELD} value={v.address} onChange={set("address")} maxLength={200} /></label>
        <label className={LABEL}>{f.lat}<input className={FIELD} value={v.lat} onChange={set("lat")} inputMode="decimal" /></label>
        <label className={LABEL}>{f.lng}<input className={FIELD} value={v.lng} onChange={set("lng")} inputMode="decimal" /></label>
      </div>
      {error ? <p className="text-[12.5px] text-risk">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="inline-flex h-10 items-center rounded-xl bg-accent px-4 text-[13px] font-bold text-accent-fg hover:opacity-90 disabled:opacity-50">
          {f.save}
        </button>
        {onDone ? (
          <button type="button" onClick={onDone} className="inline-flex h-10 items-center rounded-xl bg-surface px-4 text-[13px] font-semibold text-ink-soft hover:text-ink">
            {f.cancel}
          </button>
        ) : null}
      </div>
    </form>
  );
}

/** "Edit" on a row: the same form, opened in place. */
export function AdminGymEdit({ gym, label }: { gym: AdminGymValues; label: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex h-9 items-center rounded-xl bg-surface px-3.5 text-[12.5px] font-bold text-ink-soft hover:text-ink">
        {label}
      </button>
    );
  }
  return (
    <div className="mt-2 w-[min(32rem,80vw)] rounded-2xl bg-bg/60 p-3">
      <AdminGymForm gym={gym} onDone={() => setOpen(false)} />
    </div>
  );
}

/** Approve a suggestion: no dialog, it only makes a row visible. */
export function AdminGymApprove({ action, label }: { action: () => Promise<{ ok: boolean; message?: string }>; label: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => start(async () => { await action(); router.refresh(); })}
      className="inline-flex h-9 items-center rounded-xl bg-accent px-3.5 text-[12.5px] font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
    >
      {label}
    </button>
  );
}
