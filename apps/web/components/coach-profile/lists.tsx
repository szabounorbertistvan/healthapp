"use client";
import { useId, useState, useTransition } from "react";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import {
  COACH_LIMITS, PRICE_UNITS, SERVICE_KINDS, type CoachCertificationRow, type CoachServiceRow, type PriceUnit,
  type ServiceKind,
} from "@/lib/coach-profile";
import {
  CURRENCIES, centsToPrice, coachingSinceError, formatPrice, moveItem, priceToCents, serviceErrors,
  type ServiceErrors,
} from "@/lib/coach-onboarding";
import { BUTTON, FIELD_ERROR, FIELD_INSET, HINT, LABEL, SMALL_BUTTON, SMALL_BUTTON_INSET } from "@/lib/form-classes";
import {
  deleteCoachCertification, deleteCoachService, reorderCoachServices, saveCoachCertification, saveCoachService,
} from "@/app/coach-profile-actions";
import { EmptyState, Switch } from "../ui";
import { useCoachError } from "./status";

// The two list steps. Unlike the text steps, each row is saved on its own
// "Save" — a list has no half-written state worth autosaving — and the wizard
// keeps the rows so the checklist and the preview see them at once.

// ============================================================================
// certifications
// ============================================================================

type CertForm = { id?: string; name: string; issuer: string; year: string };
const emptyCert: CertForm = { name: "", issuer: "", year: "" };

export function CertificationsStep({
  rows, onChange,
}: {
  rows: CoachCertificationRow[];
  onChange: (rows: CoachCertificationRow[]) => void;
}) {
  const { t } = useI18n();
  const c = t.coachProfile.certifications;
  const coachError = useCoachError();
  const [form, setForm] = useState<CertForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ids = useId();

  const year = form?.year.trim() ? Number(form.year) : null;
  const nameError = form && !form.name.trim() ? c.nameRequired : null;
  const yearError = form && (Number.isNaN(year) || coachingSinceError(year)) ? c.yearError : null;

  function save() {
    if (!form || nameError || yearError) return;
    setError(null);
    start(async () => {
      const result = await saveCoachCertification({
        id: form.id, name: form.name, issuer: form.issuer || null, year,
        sortOrder: form.id ? rows.find((r) => r.id === form.id)?.sort_order ?? 0 : rows.length,
      });
      if (!result.ok || !result.id) {
        setError(coachError(result));
        return;
      }
      const row: CoachCertificationRow = {
        id: result.id,
        coach_profile_id: rows[0]?.coach_profile_id ?? "",
        name: form.name.trim(),
        issuer: form.issuer.trim() || null,
        year,
        // a renamed certificate loses its verification (the database trigger does the same)
        verification_status: "unverified",
        verified_at: null,
        sort_order: form.id ? rows.find((r) => r.id === form.id)?.sort_order ?? 0 : rows.length,
      };
      const old = rows.find((r) => r.id === form.id);
      const unchanged = old && old.name === row.name && old.issuer === row.issuer && old.year === row.year;
      onChange(form.id ? rows.map((r) => (r.id === form.id ? (unchanged ? old : row) : r)) : [...rows, row]);
      setForm(null);
    });
  }

  function remove(row: CoachCertificationRow) {
    setError(null);
    start(async () => {
      const result = await deleteCoachCertification(row.id);
      if (!result.ok) {
        setError(coachError(result));
        return;
      }
      onChange(rows.filter((r) => r.id !== row.id));
    });
  }

  const statusLabel = (s: CoachCertificationRow["verification_status"]) =>
    s === "verified" ? c.statusVerified : s === "pending" ? c.statusPending : s === "rejected" ? c.statusRejected : c.statusUnverified;

  return (
    <div>
      {rows.length === 0 && !form ? <EmptyState plain title={c.empty} hint={c.intro} /> : null}
      <ul className="grid gap-2.5">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-bg px-4 py-3">
            <div className="min-w-0">
              <p className="font-semibold">{row.name}</p>
              <p className="text-[12.5px] text-ink-faint">
                {[row.issuer, row.year].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  row.verification_status === "verified" ? "bg-accent-soft text-accent-ink"
                    : row.verification_status === "pending" ? "bg-warn-soft text-warn"
                    : "bg-surface text-ink-faint"
                }`}
              >
                {statusLabel(row.verification_status)}
              </span>
              <button
                type="button" className={SMALL_BUTTON_INSET} disabled={pending}
                onClick={() => setForm({ id: row.id, name: row.name, issuer: row.issuer ?? "", year: row.year ? String(row.year) : "" })}
              >
                {c.edit}
              </button>
              <button
                type="button" className={`${SMALL_BUTTON_INSET} text-risk`} disabled={pending}
                aria-label={fill(c.deleteLabel, { name: row.name })} onClick={() => remove(row)}
              >
                {c.delete}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {form ? (
        <div className="mt-3 rounded-2xl bg-bg p-4">
          <label className={LABEL} htmlFor={`${ids}-name`}>{c.name}</label>
          <input
            id={`${ids}-name`} className={FIELD_INSET} value={form.name} maxLength={COACH_LIMITS.certificationName}
            placeholder={c.nameHint} aria-invalid={Boolean(nameError)} autoFocus
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          {nameError && form.name !== "" ? <span className={FIELD_ERROR}>{nameError}</span> : null}
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_8rem]">
            <label className={LABEL}>
              {c.issuer}
              <input
                className={FIELD_INSET} value={form.issuer} maxLength={COACH_LIMITS.certificationIssuer}
                onChange={(e) => setForm({ ...form, issuer: e.target.value })}
              />
            </label>
            <label className={LABEL}>
              {c.year}
              <input
                className={FIELD_INSET} inputMode="numeric" value={form.year} maxLength={4} aria-invalid={Boolean(yearError)}
                onChange={(e) => setForm({ ...form, year: e.target.value.replace(/\D/g, "") })}
              />
            </label>
          </div>
          {yearError ? <span className={FIELD_ERROR}>{yearError}</span> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={BUTTON} disabled={pending || Boolean(nameError) || Boolean(yearError)} onClick={save}>
              {c.save}
            </button>
            <button type="button" className={SMALL_BUTTON_INSET} disabled={pending} onClick={() => setForm(null)}>{c.cancel}</button>
          </div>
        </div>
      ) : (
        <button type="button" className={`${SMALL_BUTTON} mt-3`} onClick={() => setForm(emptyCert)}>{c.add}</button>
      )}
      <p className={HINT}>{c.documentNote}</p>
      {error ? <p role="alert" className="mt-2 text-[13px] text-risk">{error}</p> : null}
    </div>
  );
}

// ============================================================================
// services
// ============================================================================

type ServiceForm = {
  id?: string;
  name: string;
  description: string;
  kind: ServiceKind;
  price: string;
  currency: string;
  priceUnit: PriceUnit;
  pricePublic: boolean;
  active: boolean;
};
const emptyService: ServiceForm = {
  name: "", description: "", kind: "online_coaching", price: "", currency: "RON",
  priceUnit: "month", pricePublic: true, active: true,
};

export function ServicesStep({
  rows, onChange,
}: {
  rows: CoachServiceRow[];
  onChange: (rows: CoachServiceRow[]) => void;
}) {
  const { t, locale } = useI18n();
  const s = t.coachProfile.services;
  const w = t.coachProfile.wizard;
  const coachError = useCoachError();
  const [form, setForm] = useState<ServiceForm | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ids = useId();

  const errors: ServiceErrors = form ? serviceErrors(form) : {};
  const invalid = Object.keys(errors).length > 0;
  const errorText = (k: keyof ServiceErrors) => {
    const e = errors[k];
    if (!e || !touched) return null;
    if (k === "name") return e === "REQUIRED" ? s.nameRequired : fill(w.tooLong, { max: COACH_LIMITS.serviceName });
    if (k === "description") return fill(w.tooLong, { max: COACH_LIMITS.serviceDescription });
    return e === "REQUIRED" ? s.priceRequired : s.priceFormat;
  };

  function save() {
    setTouched(true);
    if (!form || invalid) return;
    setError(null);
    const priceCents = priceToCents(form.price) ?? null;
    const sortOrder = form.id ? rows.findIndex((r) => r.id === form.id) : rows.length;
    start(async () => {
      const result = await saveCoachService({
        id: form.id, name: form.name, description: form.description || null, kind: form.kind,
        priceCents, currency: form.currency, priceUnit: form.priceUnit, pricePublic: form.pricePublic,
        active: form.active, sortOrder,
      });
      if (!result.ok || !result.id) {
        setError(coachError(result));
        return;
      }
      const row: CoachServiceRow = {
        id: result.id, coach_profile_id: rows[0]?.coach_profile_id ?? "",
        name: form.name.trim(), description: form.description.trim() || null, kind: form.kind,
        price_cents: priceCents, currency: form.currency, price_unit: form.priceUnit,
        price_public: form.pricePublic, active: form.active, sort_order: sortOrder,
      };
      onChange(form.id ? rows.map((r) => (r.id === form.id ? row : r)) : [...rows, row]);
      setForm(null);
      setTouched(false);
    });
  }

  function remove(row: CoachServiceRow) {
    setError(null);
    start(async () => {
      const result = await deleteCoachService(row.id);
      if (!result.ok) {
        setError(coachError(result));
        return;
      }
      onChange(rows.filter((r) => r.id !== row.id));
    });
  }

  function move(index: number, direction: -1 | 1) {
    const next = moveItem(rows, index, direction);
    if (next.every((r, i) => r === rows[i])) return;
    const previous = rows;
    setError(null);
    onChange(next.map((r, i) => ({ ...r, sort_order: i })));
    start(async () => {
      const result = await reorderCoachServices(next.map((r) => r.id));
      if (!result.ok) {
        onChange(previous);
        setError(coachError(result));
      }
    });
  }

  const edit = (row: CoachServiceRow) => {
    setTouched(false);
    setForm({
      id: row.id, name: row.name, description: row.description ?? "", kind: row.kind,
      price: centsToPrice(row.price_cents), currency: row.currency, priceUnit: row.price_unit,
      pricePublic: row.price_public, active: row.active,
    });
  };

  return (
    <div>
      {rows.length === 0 && !form ? <EmptyState plain title={s.empty} hint={s.intro} /> : null}
      <ul className="grid gap-2.5" data-testid="coach-services">
        {rows.map((row, i) => {
          const price = formatPrice(row.price_cents, row.currency, locale);
          return (
            <li key={row.id} className="rounded-2xl bg-bg px-4 py-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-[15px] font-bold">
                    {row.name}
                    {!row.active ? <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink-faint">{s.hidden}</span> : null}
                  </p>
                  {row.description ? <p className="mt-0.5 text-[13px] text-ink-soft">{row.description}</p> : null}
                  <p className="mt-1.5 text-[13.5px] font-semibold text-accent-ink">
                    {price ? `${price} ${s.unitShort[row.price_unit]}`.trim() : s.onRequest}
                    {!row.price_public ? <span className="ml-2 font-normal text-ink-faint">({s.priceHidden})</span> : null}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button" className={SMALL_BUTTON_INSET} disabled={pending || i === 0}
                    aria-label={fill(s.moveUp, { name: row.name })} onClick={() => move(i, -1)}
                  >↑</button>
                  <button
                    type="button" className={SMALL_BUTTON_INSET} disabled={pending || i === rows.length - 1}
                    aria-label={fill(s.moveDown, { name: row.name })} onClick={() => move(i, 1)}
                  >↓</button>
                  <button type="button" className={SMALL_BUTTON_INSET} disabled={pending} onClick={() => edit(row)}>{s.edit}</button>
                  <button
                    type="button" className={`${SMALL_BUTTON_INSET} text-risk`} disabled={pending}
                    aria-label={fill(s.deleteLabel, { name: row.name })} onClick={() => remove(row)}
                  >{s.delete}</button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {form ? (
        <div className="mt-3 rounded-2xl bg-bg p-4" data-testid="coach-service-form">
          <label className={LABEL} htmlFor={`${ids}-name`}>{s.name}</label>
          <input
            id={`${ids}-name`} className={FIELD_INSET} value={form.name} maxLength={COACH_LIMITS.serviceName}
            placeholder={s.nameHint} aria-invalid={Boolean(errorText("name"))} autoFocus
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          {errorText("name") ? <span className={FIELD_ERROR}>{errorText("name")}</span> : null}

          <label className={`${LABEL} mt-3`} htmlFor={`${ids}-description`}>{s.description}</label>
          <textarea
            id={`${ids}-description`} className={`${FIELD_INSET} h-auto min-h-20 resize-y py-2.5 leading-relaxed`}
            value={form.description} maxLength={COACH_LIMITS.serviceDescription} rows={2} placeholder={s.descriptionHint}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          {errorText("description") ? <span className={FIELD_ERROR}>{errorText("description")}</span> : null}

          <label className={`${LABEL} mt-3`}>
            {s.kind}
            <select
              className={FIELD_INSET} value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as ServiceKind })}
            >
              {SERVICE_KINDS.map((k) => <option key={k} value={k}>{s.kinds[k]}</option>)}
            </select>
          </label>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className={LABEL}>
              {s.price}
              <input
                className={FIELD_INSET} inputMode="decimal" value={form.price} aria-invalid={Boolean(errorText("price"))}
                aria-describedby={`${ids}-price-hint`}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </label>
            <label className={LABEL}>
              {s.currency}
              <select className={FIELD_INSET} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                {CURRENCIES.map((cur) => <option key={cur} value={cur}>{cur}</option>)}
              </select>
            </label>
            <label className={LABEL}>
              {s.unit}
              <select
                className={FIELD_INSET} value={form.priceUnit}
                onChange={(e) => setForm({ ...form, priceUnit: e.target.value as PriceUnit })}
              >
                {PRICE_UNITS.map((u) => <option key={u} value={u}>{s.units[u]}</option>)}
              </select>
            </label>
          </div>
          <p id={`${ids}-price-hint`} className={HINT}>{s.priceHint}</p>
          {errorText("price") ? <span className={FIELD_ERROR}>{errorText("price")}</span> : null}

          <div className="mt-4 grid gap-3">
            <Switch
              checked={form.pricePublic} onChange={(v) => setForm({ ...form, pricePublic: v })}
              label={s.publicPrice} hint={s.publicPriceHint} onLabel={w.on} offLabel={w.off} inset
            />
            <Switch
              checked={form.active} onChange={(v) => setForm({ ...form, active: v })}
              label={s.active} hint={s.activeHint} onLabel={w.on} offLabel={w.off} inset
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={BUTTON} disabled={pending} onClick={save}>{s.save}</button>
            <button
              type="button" className={SMALL_BUTTON_INSET} disabled={pending}
              onClick={() => { setForm(null); setTouched(false); }}
            >{s.cancel}</button>
          </div>
        </div>
      ) : (
        <button type="button" className={`${SMALL_BUTTON} mt-3`} onClick={() => { setTouched(false); setForm(emptyService); }}>
          {s.add}
        </button>
      )}
      {error ? <p role="alert" className="mt-2 text-[13px] text-risk">{error}</p> : null}
    </div>
  );
}
