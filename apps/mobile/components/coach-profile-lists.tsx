import {
  CURRENCIES, PRICING_MODELS, centsToPrice, coachingSinceError, credentialLabel, formatPrice, moveItem, parseDuration, priceToCents,
  pricingOf, serviceErrors, takesPrice, unitsFor, type PricingModel, type ServiceErrors,
} from "@healthapp/shared/coach/onboarding";
import {
  COACH_LIMITS, DURATION_UNITS, SERVICE_DELIVERY, SERVICE_KINDS, type CoachCertificationRow, type CoachServiceRow,
  type DurationUnit, type PriceUnit, type ServiceDelivery, type ServiceKind,
} from "@healthapp/shared/coach/profile";
import { useState } from "react";
import { Text, View } from "react-native";
import { ErrorText, Pill, Primary, Small, useCoachError } from "@/components/coach-profile-bits";
import { Field, Hint, Pills, Switch } from "@/components/settings-forms";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The wizard's two list steps (components/coach-profile/lists.tsx): each row is
// saved on its own Save, and the wizard keeps the rows so the checklist and
// the preview see them at once. A select is a row of pills on a phone; a date
// is typed as yyyy-mm-dd.

type Currency = (typeof CURRENCIES)[number];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "60 minutes" — or null (service-format.tsx useServiceDuration). */
export function useServiceDuration() {
  const { t } = useI18n();
  const s = t.coachProfile.services;
  return (value: number | null, unit: DurationUnit | null) => (value && unit ? `${value} ${s.durationUnits[unit]}` : null);
}

/** "Free", "400 RON / month", "Price on request", "Price shared after contact" (useServicePrice). */
export function useServicePrice() {
  const { t, locale } = useI18n();
  const s = t.coachProfile.services;
  return (sv: { price_unit: PriceUnit; price_cents: number | null; currency: string | null; price_public: boolean }) => {
    if (sv.price_unit === "free") return s.free;
    if (!sv.price_public) return s.priceHidden;
    const price = formatPrice(sv.price_cents, sv.currency, locale);
    return price ? `${price} ${s.unitShort[sv.price_unit]}`.trim() : s.onRequest;
  };
}

// ---------- certifications ----------

type CertForm = { id?: string; name: string; issuer: string; year: string; number: string; expires: string };
const emptyCert: CertForm = { name: "", issuer: "", year: "", number: "", expires: "" };

export function CertificationsStep({ rows, onChange }: { rows: CoachCertificationRow[]; onChange: (rows: CoachCertificationRow[]) => void }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const c = t.coachProfile.certifications;
  const coachError = useCoachError();
  const [form, setForm] = useState<CertForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const year = form?.year.trim() ? Number(form.year) : null;
  const nameError = form && !form.name.trim() ? c.nameRequired : null;
  const yearError = form && (Number.isNaN(year) || coachingSinceError(year)) ? c.yearError : null;
  const expiresError = form && form.expires.trim() && !DAY.test(form.expires.trim()) ? fill(t.mobile.forms.dateFormat, { example: "2027-06-30" }) : null;

  async function save() {
    if (!form || nameError || yearError || expiresError) return;
    setError(null);
    setPending(true);
    const sortOrder = form.id ? rows.find((r) => r.id === form.id)?.sort_order ?? 0 : rows.length;
    try {
      const result = await api.coachProfileWrite("certification", {
        certification: {
          id: form.id, name: form.name, issuer: form.issuer || null, year,
          credentialNumber: form.number.trim() || null, expiresOn: form.expires.trim() || null, sortOrder,
        },
      });
      if (!result.ok || !result.id) return setError(coachError(result));
      const row: CoachCertificationRow = {
        id: result.id, coach_profile_id: rows[0]?.coach_profile_id ?? "", name: form.name.trim(), issuer: form.issuer.trim() || null, year,
        credential_number: form.number.trim() || null, expires_on: form.expires.trim() || null,
        // an edited credential is self-reported again (the database trigger does the same)
        verification_status: "unverified", verified_at: null, sort_order: sortOrder,
      };
      const old = rows.find((r) => r.id === form.id);
      const unchanged = old && old.name === row.name && old.issuer === row.issuer && old.year === row.year
        && old.credential_number === row.credential_number && old.expires_on === row.expires_on;
      onChange(form.id ? rows.map((r) => (r.id === form.id ? (unchanged ? old : row) : r)) : [...rows, row]);
      setForm(null);
    } catch (e) {
      setError(coachError(e));
    } finally {
      setPending(false);
    }
  }

  async function remove(row: CoachCertificationRow) {
    setError(null);
    setPending(true);
    try {
      const result = await api.coachProfileWrite("deleteCertification", { id: row.id });
      if (!result.ok) return setError(coachError(result));
      onChange(rows.filter((r) => r.id !== row.id));
    } catch (e) {
      setError(coachError(e));
    } finally {
      setPending(false);
    }
  }

  const statusLabel = (s: CoachCertificationRow["verification_status"]) =>
    s === "verified" ? c.statusVerified : s === "pending" ? c.statusPending : s === "rejected" ? c.statusRejected : c.statusUnverified;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <View style={{ gap: 10 }}>
      {rows.length === 0 && !form ? <Empty title={c.empty} hint={c.intro} /> : null}
      {rows.map((row) => (
        <View key={row.id} style={{ borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: color.bg, gap: 8 }}>
          <View>
            <Text style={{ fontFamily: font.semibold, fontSize: 14.5, color: color.ink }}>{row.name}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
              {[row.issuer, row.year, row.credential_number ? fill(c.numberShort, { n: row.credential_number }) : null,
                row.expires_on ? fill(c.expiresShort, { date: row.expires_on }) : null].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            {credentialLabel(row, today).expired ? <Pill label={c.expired} tone="risk" /> : null}
            <Pill label={statusLabel(row.verification_status)} tone={row.verification_status === "verified" ? "accent" : row.verification_status === "pending" ? "warn" : "neutral"} />
            <Small label={c.edit} disabled={pending} onPress={() => setForm({
              id: row.id, name: row.name, issuer: row.issuer ?? "", year: row.year ? String(row.year) : "", number: row.credential_number ?? "", expires: row.expires_on ?? "",
            })} />
            <Small label={c.delete} tone="risk" disabled={pending} onPress={() => void remove(row)} />
          </View>
        </View>
      ))}
      {form ? (
        <View style={{ borderRadius: 16, padding: 14, backgroundColor: color.bg, gap: 12 }}>
          <Field label={c.name} value={form.name} onChange={(v) => setForm({ ...form, name: v })} maxLength={COACH_LIMITS.certificationName} placeholder={c.nameHint}
            error={nameError && form.name !== "" ? nameError : null} />
          <Field label={c.issuer} value={form.issuer} onChange={(v) => setForm({ ...form, issuer: v })} maxLength={COACH_LIMITS.certificationIssuer} />
          <Field label={c.year} value={form.year} onChange={(v) => setForm({ ...form, year: v.replace(/\D/g, "") })} maxLength={4} keyboardType="number-pad" plain error={yearError} />
          <Field label={c.number} value={form.number} onChange={(v) => setForm({ ...form, number: v })} maxLength={80} plain />
          <Field label={c.expires} value={form.expires} onChange={(v) => setForm({ ...form, expires: v })} maxLength={10} keyboardType="numbers-and-punctuation" plain placeholder="2027-06-30" error={expiresError} />
          <Hint>{c.numberHint}</Hint>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Primary label={c.save} busy={pending} disabled={Boolean(nameError || yearError || expiresError)} onPress={() => void save()} />
            <Small label={c.cancel} disabled={pending} onPress={() => setForm(null)} style={{ height: 44, borderRadius: 14 }} />
          </View>
        </View>
      ) : (
        <View style={{ alignSelf: "flex-start" }}><Small label={c.add} onPress={() => setForm(emptyCert)} /></View>
      )}
      <Hint>{c.documentNote}</Hint>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

// ---------- services ----------

type ServiceForm = {
  id?: string; name: string; description: string; kind: ServiceKind; delivery: ServiceDelivery; durationValue: string; durationUnit: DurationUnit;
  pricing: PricingModel; price: string; currency: Currency; priceUnit: PriceUnit; pricePublic: boolean; active: boolean;
};
const emptyService: ServiceForm = {
  name: "", description: "", kind: "online_coaching", delivery: "online", durationValue: "", durationUnit: "minutes",
  pricing: "recurring", price: "", currency: "RON", priceUnit: "month", pricePublic: true, active: true,
};

/**
 * The coach's services: `full` in a draft (add, edit, delete, reorder, switch),
 * `manage` outside it (switch and reorder only, live, without a review).
 */
export function ServicesStep({ rows, onChange, mode = "full" }: { rows: CoachServiceRow[]; onChange: (rows: CoachServiceRow[]) => void; mode?: "full" | "manage" }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const s = t.coachProfile.services;
  const w = t.coachProfile.wizard;
  const coachError = useCoachError();
  const durationText = useServiceDuration();
  const priceText = useServicePrice();
  const [form, setForm] = useState<ServiceForm | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
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

  const setPricing = (pricing: PricingModel) => {
    if (!form) return;
    const units = unitsFor(pricing);
    setForm({ ...form, pricing, priceUnit: units.includes(form.priceUnit) ? form.priceUnit : units[pricing === "recurring" ? 1 : 0]! });
  };

  async function guarded(fn: () => Promise<void>) {
    setError(null);
    setPending(true);
    try {
      await fn();
    } catch (e) {
      setError(coachError(e));
    } finally {
      setPending(false);
    }
  }

  function save() {
    setTouched(true);
    if (!form || invalid) return;
    const priceCents = takesPrice(form.priceUnit) ? priceToCents(form.price) ?? null : null;
    const durationValue = parseDuration(form.durationValue) ?? null;
    const durationUnit = durationValue ? form.durationUnit : null;
    const sortOrder = form.id ? rows.findIndex((r) => r.id === form.id) : rows.length;
    void guarded(async () => {
      const result = await api.coachProfileWrite("service", {
        service: {
          id: form.id, name: form.name, description: form.description || null, kind: form.kind, delivery: form.delivery, durationValue, durationUnit,
          priceCents, currency: form.currency, priceUnit: form.priceUnit, pricePublic: form.pricePublic, active: form.active, sortOrder,
        },
      });
      if (!result.ok || !result.id) return setError(coachError(result));
      const row: CoachServiceRow = {
        id: result.id, coach_profile_id: rows[0]?.coach_profile_id ?? "", name: form.name.trim(), description: form.description.trim() || null, kind: form.kind,
        delivery: form.delivery, duration_value: durationValue, duration_unit: durationUnit, price_cents: priceCents, currency: form.currency,
        price_unit: form.priceUnit, price_public: form.pricePublic, active: form.active, sort_order: sortOrder,
      };
      onChange(form.id ? rows.map((r) => (r.id === form.id ? row : r)) : [...rows, row]);
      setForm(null);
      setTouched(false);
    });
  }

  function remove(row: CoachServiceRow) {
    void guarded(async () => {
      const result = await api.coachProfileWrite("deleteService", { id: row.id });
      if (!result.ok) return setError(coachError(result));
      onChange(rows.filter((r) => r.id !== row.id));
    });
  }

  function toggle(row: CoachServiceRow) {
    const previous = rows;
    onChange(rows.map((r) => (r.id === row.id ? { ...r, active: !r.active } : r)));
    void guarded(async () => {
      const result = await api.coachProfileWrite("serviceActive", { id: row.id, active: !row.active });
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
    onChange(next.map((r, i) => ({ ...r, sort_order: i })));
    void guarded(async () => {
      const result = await api.coachProfileWrite("reorderServices", { ids: next.map((r) => r.id) });
      if (!result.ok) {
        onChange(previous);
        setError(coachError(result));
      }
    });
  }

  const edit = (row: CoachServiceRow) => {
    setTouched(false);
    setForm({
      id: row.id, name: row.name, description: row.description ?? "", kind: row.kind, delivery: row.delivery,
      durationValue: row.duration_value?.toString() ?? "", durationUnit: row.duration_unit ?? "minutes",
      pricing: pricingOf(row.price_unit), price: centsToPrice(row.price_cents),
      currency: (CURRENCIES as readonly string[]).includes(row.currency) ? (row.currency as Currency) : "RON",
      priceUnit: row.price_unit, pricePublic: row.price_public, active: row.active,
    });
  };

  return (
    <View style={{ gap: 10 }}>
      {rows.length === 0 && !form ? <Empty title={s.empty} hint={s.intro} /> : null}
      {rows.map((row, i) => {
        const duration = durationText(row.duration_value, row.duration_unit);
        return (
          <View key={row.id} style={{ borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: color.bg, opacity: row.active ? 1 : 0.7, gap: 8 }}>
            <View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <Text style={{ fontFamily: font.displayBold, fontSize: 15, color: color.ink }}>{row.name}</Text>
                {!row.active ? <Pill label={s.hidden} tone="neutral" /> : null}
              </View>
              <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
                {[s.kinds[row.kind], s.deliveries[row.delivery], duration].filter(Boolean).join(" · ")}
              </Text>
              {row.description ? <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: color.inkSoft }}>{row.description}</Text> : null}
              <Text style={{ marginTop: 6, fontFamily: font.semibold, fontSize: 13.5, color: color.accentInk }}>{priceText(row)}</Text>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <Small label={row.active ? s.stopOffering : s.offer} disabled={pending} onPress={() => toggle(row)} />
              <Small label="↑" disabled={pending || i === 0} onPress={() => move(i, -1)} />
              <Small label="↓" disabled={pending || i === rows.length - 1} onPress={() => move(i, 1)} />
              {full ? (
                <>
                  <Small label={s.edit} disabled={pending} onPress={() => edit(row)} />
                  <Small label={s.delete} tone="risk" disabled={pending} onPress={() => remove(row)} />
                </>
              ) : null}
            </View>
          </View>
        );
      })}

      {full && form ? (
        <View style={{ borderRadius: 16, padding: 14, backgroundColor: color.bg, gap: 12 }}>
          <Field label={s.name} value={form.name} onChange={(v) => setForm({ ...form, name: v })} maxLength={COACH_LIMITS.serviceName} placeholder={s.nameHint} error={errorText("name")} />
          <Field label={s.description} value={form.description} onChange={(v) => setForm({ ...form, description: v })} maxLength={COACH_LIMITS.serviceDescription}
            placeholder={s.descriptionHint} multiline error={errorText("description")} />
          <Pills label={s.kind} value={form.kind} onChange={(v) => setForm({ ...form, kind: v })} options={SERVICE_KINDS.map((k) => ({ value: k, label: s.kinds[k] }))} />
          <View>
            <Pills label={s.delivery} value={form.delivery} onChange={(v) => setForm({ ...form, delivery: v })} options={SERVICE_DELIVERY.map((d) => ({ value: d, label: s.deliveries[d] }))} />
            <Hint>{s.deliveryHints[form.delivery]}</Hint>
          </View>
          <View>
            <Field label={s.duration} value={form.durationValue} onChange={(v) => setForm({ ...form, durationValue: v.replace(/\D/g, "").slice(0, 4) })}
              keyboardType="number-pad" plain placeholder="60" error={errorText("duration")} />
            <View style={{ marginTop: 4 }}>
              <Pills label="" value={form.durationUnit} onChange={(v) => setForm({ ...form, durationUnit: v })} options={DURATION_UNITS.map((u) => ({ value: u, label: s.durationUnits[u] }))} />
            </View>
            <Hint>{s.durationHint}</Hint>
          </View>
          <View>
            <Pills label={s.pricing} value={form.pricing} onChange={setPricing} options={PRICING_MODELS.map((m) => ({ value: m, label: s.pricingModels[m] }))} />
            <Hint>{s.pricingHints[form.pricing]}</Hint>
          </View>
          {takesPrice(form.priceUnit) ? (
            <>
              <Field label={s.price} value={form.price} onChange={(v) => setForm({ ...form, price: v })} keyboardType="numbers-and-punctuation" plain error={errorText("price")} />
              <Pills label={s.currency} value={form.currency} onChange={(v) => setForm({ ...form, currency: v })} options={CURRENCIES.map((cur) => ({ value: cur, label: cur }))} />
              <Pills label={form.pricing === "recurring" ? s.billingPeriod : s.per} value={form.priceUnit} onChange={(v) => setForm({ ...form, priceUnit: v })}
                options={unitsFor(form.pricing).map((u) => ({ value: u, label: s.units[u] }))} />
              <Hint>{s.priceHint}</Hint>
            </>
          ) : errorText("price") ? <ErrorText>{errorText("price")}</ErrorText> : null}
          {takesPrice(form.priceUnit) ? (
            <Switch label={s.publicPrice} hint={s.publicPriceHint} value={form.pricePublic} onChange={(v) => setForm({ ...form, pricePublic: v })} onLabel={w.on} offLabel={w.off} />
          ) : null}
          <Switch label={s.active} hint={s.activeHint} value={form.active} onChange={(v) => setForm({ ...form, active: v })} onLabel={w.on} offLabel={w.off} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Primary label={s.save} busy={pending} onPress={save} />
            <Small label={s.cancel} disabled={pending} onPress={() => { setForm(null); setTouched(false); }} style={{ height: 44, borderRadius: 14 }} />
          </View>
        </View>
      ) : full ? (
        <View style={{ alignSelf: "flex-start" }}><Small label={s.add} onPress={() => { setTouched(false); setForm(emptyService); }} /></View>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

function Empty({ title, hint }: { title: string; hint: string }) {
  const { color } = useTheme();
  return (
    <View style={{ borderRadius: 16, paddingHorizontal: 18, paddingVertical: 22, backgroundColor: color.bg, alignItems: "center" }}>
      <Text style={{ fontFamily: font.displayBold, fontSize: 16, color: color.ink, textAlign: "center" }}>{title}</Text>
      <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: color.inkSoft, textAlign: "center" }}>{hint}</Text>
    </View>
  );
}
