"use client";
import { useId, useState, useTransition } from "react";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import {
  COACH_LIMITS, DURATION_UNITS, SERVICE_DELIVERY, SERVICE_KINDS, type CoachCertificationRow, type CoachServiceRow,
  type DurationUnit, type PriceUnit, type ServiceDelivery, type ServiceKind,
} from "@/lib/coach-profile";
import {
  CURRENCIES, PRICING_MODELS, centsToPrice, coachingSinceError, credentialLabel, formatPrice, moveItem, parseDuration, priceToCents,
  pricingOf, serviceErrors, takesPrice, unitsFor, type PricingModel, type ServiceErrors,
} from "@/lib/coach-onboarding";
import { BUTTON, FIELD_ERROR, FIELD_INSET, HINT, LABEL, SMALL_BUTTON, SMALL_BUTTON_INSET } from "@/lib/form-classes";
import {
  deleteCoachCertification, deleteCoachService, reorderCoachServices, saveCoachCertification, saveCoachService,
  setCoachServiceActive,
} from "@/app/coach-profile-actions";

type Currency = (typeof CURRENCIES)[number];
import { useRouter } from "next/navigation";
import { Card, EmptyState, Switch } from "../ui";
import { useCoachError } from "./status";
import { useServiceDuration, useServicePrice } from "./service-format";

// The two list steps. Unlike the text steps, each row is saved on its own
// "Save" — a list has no half-written state worth autosaving — and the wizard
// keeps the rows so the checklist and the preview see them at once.

// ============================================================================
// certifications
// ============================================================================

type CertForm = { id?: string; name: string; issuer: string; year: string; number: string; expires: string };
const emptyCert: CertForm = { name: "", issuer: "", year: "", number: "", expires: "" };

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
        credentialNumber: form.number.trim() || null, expiresOn: form.expires || null,
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
        credential_number: form.number.trim() || null,
        expires_on: form.expires || null,
        // an edited credential is self-reported again (the database trigger does the same)
        verification_status: "unverified",
        verified_at: null,
        sort_order: form.id ? rows.find((r) => r.id === form.id)?.sort_order ?? 0 : rows.length,
      };
      const old = rows.find((r) => r.id === form.id);
      const unchanged = old && old.name === row.name && old.issuer === row.issuer && old.year === row.year
        && old.credential_number === row.credential_number && old.expires_on === row.expires_on;
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
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      {rows.length === 0 && !form ? <EmptyState plain title={c.empty} hint={c.intro} /> : null}
      <ul className="grid gap-2.5">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-bg px-4 py-3">
            <div className="min-w-0">
              <p className="font-semibold">{row.name}</p>
              <p className="text-[12.5px] text-ink-faint">
                {[row.issuer, row.year, row.credential_number ? fill(c.numberShort, { n: row.credential_number }) : null,
                  row.expires_on ? fill(c.expiresShort, { date: row.expires_on }) : null].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2" data-testid="coach-credential-status" data-status={row.verification_status}>
              {credentialLabel(row, today).expired ? (
                <span className="rounded-full bg-risk-soft px-2.5 py-1 text-[11px] font-semibold text-risk">{c.expired}</span>
              ) : null}
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
                onClick={() => setForm({
                  id: row.id, name: row.name, issuer: row.issuer ?? "", year: row.year ? String(row.year) : "",
                  number: row.credential_number ?? "", expires: row.expires_on ?? "",
                })}
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
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className={LABEL}>
              {c.number}
              <input
                className={FIELD_INSET} value={form.number} maxLength={80} autoComplete="off"
                onChange={(e) => setForm({ ...form, number: e.target.value })}
              />
            </label>
            <label className={LABEL}>
              {c.expires}
              <input
                type="date" className={FIELD_INSET} value={form.expires} min="1950-01-01" max="2100-12-31"
                onChange={(e) => setForm({ ...form, expires: e.target.value })}
              />
            </label>
          </div>
          <p className={HINT}>{c.numberHint}</p>
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
  delivery: ServiceDelivery;
  durationValue: string;
  durationUnit: DurationUnit;
  pricing: PricingModel;
  price: string;
  currency: Currency;
  priceUnit: PriceUnit;
  pricePublic: boolean;
  active: boolean;
};
const emptyService: ServiceForm = {
  name: "", description: "", kind: "online_coaching", delivery: "online", durationValue: "", durationUnit: "minutes",
  pricing: "recurring", price: "", currency: "RON", priceUnit: "month", pricePublic: true, active: true,
};

/**
 * The coach's services. Two modes:
 *
 *   full    — the wizard's step in a draft: add, edit, delete, reorder, switch;
 *   manage  — a profile in review, published or hidden (20261031100000): only
 *             switch on/off and reorder, the operational part that needs no
 *             review; details change in a draft, under review.
 *
 * Switching and ordering go through coach_set_service_active() /
 * coach_reorder_services() in both modes; the database refuses anything else
 * outside draft (RLS) and switching off the last active service of a public
 * profile (LAST_ACTIVE_SERVICE).
 */
export function ServicesStep({
  rows, onChange, mode = "full",
}: {
  rows: CoachServiceRow[];
  onChange: (rows: CoachServiceRow[]) => void;
  mode?: "full" | "manage";
}) {
  const { t } = useI18n();
  const s = t.coachProfile.services;
  const w = t.coachProfile.wizard;
  const coachError = useCoachError();
  const durationText = useServiceDuration();
  const priceText = useServicePrice();
  const [form, setForm] = useState<ServiceForm | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ids = useId();
  const full = mode === "full";

  const errors: ServiceErrors = form ? serviceErrors(form) : {};
  const invalid = Object.keys(errors).length > 0;
  const errorText = (k: keyof ServiceErrors) => {
    const e = errors[k];
    if (!e || !touched) return null;
    if (k === "name") return e === "REQUIRED" ? s.nameRequired : fill(w.tooLong, { max: COACH_LIMITS.serviceName });
    if (k === "description") return fill(w.tooLong, { max: COACH_LIMITS.serviceDescription });
    if (k === "duration") return s.durationFormat;
    return e === "REQUIRED" ? s.priceRequired : s.priceFormat;
  };

  /** A new pricing model picks its first unit; the price is kept for when it applies again. */
  const setPricing = (pricing: PricingModel) => {
    if (!form) return;
    const units = unitsFor(pricing);
    setForm({ ...form, pricing, priceUnit: units.includes(form.priceUnit) ? form.priceUnit : units[pricing === "recurring" ? 1 : 0] });
  };

  function save() {
    setTouched(true);
    if (!form || invalid) return;
    setError(null);
    const priceCents = takesPrice(form.priceUnit) ? priceToCents(form.price) ?? null : null;
    const durationValue = parseDuration(form.durationValue) ?? null;
    const durationUnit = durationValue ? form.durationUnit : null;
    const sortOrder = form.id ? rows.findIndex((r) => r.id === form.id) : rows.length;
    start(async () => {
      const result = await saveCoachService({
        id: form.id, name: form.name, description: form.description || null, kind: form.kind,
        delivery: form.delivery, durationValue, durationUnit,
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
        delivery: form.delivery, duration_value: durationValue, duration_unit: durationUnit,
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

  function toggle(row: CoachServiceRow) {
    const previous = rows;
    setError(null);
    onChange(rows.map((r) => (r.id === row.id ? { ...r, active: !r.active } : r)));
    start(async () => {
      const result = await setCoachServiceActive(row.id, !row.active);
      if (!result.ok) {
        onChange(previous);
        setError(coachError(result));
      }
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
      delivery: row.delivery, durationValue: row.duration_value?.toString() ?? "", durationUnit: row.duration_unit ?? "minutes",
      pricing: pricingOf(row.price_unit), price: centsToPrice(row.price_cents),
      currency: (CURRENCIES as readonly string[]).includes(row.currency) ? (row.currency as Currency) : "RON",
      priceUnit: row.price_unit, pricePublic: row.price_public, active: row.active,
    });
  };

  return (
    <div>
      {rows.length === 0 && !form ? <EmptyState plain title={s.empty} hint={s.intro} /> : null}
      <ul className="grid gap-2.5" data-testid="coach-services">
        {rows.map((row, i) => {
          const duration = durationText(row.duration_value, row.duration_unit);
          return (
            <li key={row.id} className={`rounded-2xl bg-bg px-4 py-3.5 ${row.active ? "" : "opacity-70"}`} data-active={row.active}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-display text-[15px] font-bold">
                    {row.name}
                    {!row.active ? <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink-faint">{s.hidden}</span> : null}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-ink-faint">
                    {[s.kinds[row.kind], s.deliveries[row.delivery], duration].filter(Boolean).join(" · ")}
                  </p>
                  {row.description ? <p className="mt-1 text-[13px] text-ink-soft">{row.description}</p> : null}
                  <p className="mt-1.5 text-[13.5px] font-semibold text-accent-ink">{priceText(row)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button" className={SMALL_BUTTON_INSET} disabled={pending} onClick={() => toggle(row)}
                    aria-pressed={row.active} data-testid="coach-service-toggle"
                  >{row.active ? s.stopOffering : s.offer}</button>
                  <button
                    type="button" className={SMALL_BUTTON_INSET} disabled={pending || i === 0}
                    aria-label={fill(s.moveUp, { name: row.name })} onClick={() => move(i, -1)}
                  >↑</button>
                  <button
                    type="button" className={SMALL_BUTTON_INSET} disabled={pending || i === rows.length - 1}
                    aria-label={fill(s.moveDown, { name: row.name })} onClick={() => move(i, 1)}
                  >↓</button>
                  {full ? (
                    <>
                      <button type="button" className={SMALL_BUTTON_INSET} disabled={pending} onClick={() => edit(row)}>{s.edit}</button>
                      <button
                        type="button" className={`${SMALL_BUTTON_INSET} text-risk`} disabled={pending}
                        aria-label={fill(s.deleteLabel, { name: row.name })} onClick={() => remove(row)}
                      >{s.delete}</button>
                    </>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {full && form ? (
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

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className={LABEL}>
              {s.kind}
              <select className={FIELD_INSET} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ServiceKind })}>
                {SERVICE_KINDS.map((k) => <option key={k} value={k}>{s.kinds[k]}</option>)}
              </select>
            </label>
            <label className={LABEL}>
              {s.delivery}
              <select
                className={FIELD_INSET} value={form.delivery} aria-describedby={`${ids}-delivery-hint`}
                onChange={(e) => setForm({ ...form, delivery: e.target.value as ServiceDelivery })}
              >
                {SERVICE_DELIVERY.map((d) => <option key={d} value={d}>{s.deliveries[d]}</option>)}
              </select>
            </label>
          </div>
          <p id={`${ids}-delivery-hint`} className={HINT}>{s.deliveryHints[form.delivery]}</p>

          <fieldset className="mt-3">
            <legend className={LABEL}>{s.duration}</legend>
            <div className="grid grid-cols-2 gap-3">
              <label className="sr-only" htmlFor={`${ids}-duration`}>{s.durationValue}</label>
              <input
                id={`${ids}-duration`} className={FIELD_INSET} inputMode="numeric" value={form.durationValue}
                placeholder="60" aria-invalid={Boolean(errorText("duration"))}
                onChange={(e) => setForm({ ...form, durationValue: e.target.value.replace(/\D/g, "").slice(0, 4) })}
              />
              <select
                aria-label={s.duration} className={FIELD_INSET} value={form.durationUnit}
                onChange={(e) => setForm({ ...form, durationUnit: e.target.value as DurationUnit })}
              >
                {DURATION_UNITS.map((u) => <option key={u} value={u}>{s.durationUnits[u]}</option>)}
              </select>
            </div>
            <p className={HINT}>{s.durationHint}</p>
            {errorText("duration") ? <span className={FIELD_ERROR}>{errorText("duration")}</span> : null}
          </fieldset>

          <fieldset className="mt-4">
            <legend className={LABEL}>{s.pricing}</legend>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4" role="radiogroup" aria-label={s.pricing}>
              {PRICING_MODELS.map((m) => (
                <button
                  key={m} type="button" role="radio" aria-checked={form.pricing === m} onClick={() => setPricing(m)}
                  className={`h-11 rounded-xl px-3 text-[13px] font-semibold transition ${
                    form.pricing === m ? "bg-accent text-accent-fg" : "bg-surface text-ink-soft hover:text-ink"}`}
                >
                  {s.pricingModels[m]}
                </button>
              ))}
            </div>
            <p className={HINT}>{s.pricingHints[form.pricing]}</p>

            {takesPrice(form.priceUnit) ? (
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
                  <select className={FIELD_INSET} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as Currency })}>
                    {CURRENCIES.map((cur) => <option key={cur} value={cur}>{cur}</option>)}
                  </select>
                </label>
                <label className={LABEL}>
                  {form.pricing === "recurring" ? s.billingPeriod : s.per}
                  <select
                    className={FIELD_INSET} value={form.priceUnit}
                    onChange={(e) => setForm({ ...form, priceUnit: e.target.value as PriceUnit })}
                  >
                    {unitsFor(form.pricing).map((u) => <option key={u} value={u}>{s.units[u]}</option>)}
                  </select>
                </label>
              </div>
            ) : null}
            {takesPrice(form.priceUnit) ? <p id={`${ids}-price-hint`} className={HINT}>{s.priceHint}</p> : null}
            {errorText("price") ? <span className={FIELD_ERROR}>{errorText("price")}</span> : null}
          </fieldset>

          <div className="mt-4 grid gap-3">
            {takesPrice(form.priceUnit) ? (
              <Switch
                checked={form.pricePublic} onChange={(v) => setForm({ ...form, pricePublic: v })}
                label={s.publicPrice} hint={s.publicPriceHint} onLabel={w.on} offLabel={w.off} inset
              />
            ) : null}
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
      ) : full ? (
        <button type="button" className={`${SMALL_BUTTON} mt-3`} onClick={() => { setTouched(false); setForm(emptyService); }}>
          {s.add}
        </button>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-[13px] text-risk">{error}</p> : null}
    </div>
  );
}

/**
 * /settings/coach-profile outside draft: the coach's services in `manage`
 * mode — switch on/off and reorder, live, without a new review. The page's
 * read-only preview below re-reads after each change.
 */
export function ServicesManager({ initial }: { initial: CoachServiceRow[] }) {
  const { t } = useI18n();
  const s = t.coachProfile.services;
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  return (
    <Card plain>
      <section aria-labelledby="coach-services-manage" data-testid="coach-services-manage">
        <h2 id="coach-services-manage" className="font-display text-lg font-bold tracking-tight">{s.manageTitle}</h2>
        <p className={`${HINT} mb-3`}>{s.manageHint}</p>
        <ServicesStep mode="manage" rows={rows} onChange={(next) => { setRows(next); router.refresh(); }} />
      </section>
    </Card>
  );
}
