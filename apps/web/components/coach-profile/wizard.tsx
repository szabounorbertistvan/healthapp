"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import {
  COACH_LIMITS, type CoachCatalog, type CoachCertificationRow, type CoachProfileMissing, type CoachPublicProfile,
  type CoachServiceRow, type MyCoachProfile,
} from "@/lib/coach-profile";
import {
  STEPS, coachingSinceError, identityErrors, missingFor, slugify, stepForMissing, stepsTouched, summary,
  toggleSpecialization, type DraftState,
} from "@/lib/coach-onboarding";
import { BUTTON, FIELD, FIELD_ERROR, HINT, LABEL, SMALL_BUTTON, SMALL_BUTTON_INSET } from "@/lib/form-classes";
import { checkImage, uploadSignedImage } from "@/lib/cloudinary-upload";
import {
  removeCover, requestCoverUpload, saveCover, saveCoachProfileDraft, setCoachLanguages, setCoachLocations,
  setCoachSpecializations, submitCoachForReview,
} from "@/app/coach-profile-actions";
import type { ActionResult } from "@/app/actions";
import { Logo } from "../logo";
import { AvatarPicker } from "../account";
import { Card, Chip, Switch } from "../ui";
import { CertificationsStep, ServicesStep } from "./lists";
import { searchGyms } from "@/app/gym-actions";
import type { GymHit } from "@/lib/gym-data";
import { CoachProfilePreview } from "./preview";
import { COACH_PROFILE_PATH, useCoachError } from "./status";

/** How long the text steps wait after the last keystroke before saving. */
const AUTOSAVE_MS = 1500;

type SaveState = "idle" | "saving" | "saved" | "error";

/** The three groups of draft fields, each written by its own action. */
export type Saved = Pick<DraftState,
  "slug" | "headline" | "about" | "coachingSince" | "online" | "inPerson" |
  "specializations" | "primarySpecialization" | "languages" | "locations">;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function initialDraft(data: MyCoachProfile): Saved {
  const p = data.profile;
  return {
    slug: p.slug,
    headline: p.headline ?? "",
    about: p.about ?? "",
    coachingSince: p.coaching_since,
    online: p.online,
    inPerson: p.in_person,
    specializations: data.specializations.map((s) => s.slug),
    primarySpecialization: data.specializations.find((s) => s.is_primary)?.slug ?? data.specializations[0]?.slug ?? null,
    languages: data.languages,
    locations: data.locations.map((l) => ({ city: l.city_slug, gymName: l.gym_name ?? "", gymId: l.gym_id })),
  };
}

/**
 * The six-step coach profile editor. Only mounted for a draft — the page shows
 * the status panel and the preview otherwise.
 *
 * Persistence is the server's: every step saves through the coach-profile
 * actions on Continue / Back / a progress dot, and the text steps also save
 * themselves after AUTOSAVE_MS of quiet. Leaving the page with something
 * unsaved asks first. The step lives in the URL (?step=3), so a reload or a
 * shared link lands on the same screen with the saved data.
 */
export function CoachProfileWizard({
  data, catalog, step, displayName, avatarUrl, photoUploads,
}: {
  data: MyCoachProfile;
  catalog: CoachCatalog;
  step: number;
  displayName: string;
  avatarUrl: string | null;
  photoUploads: boolean;
}) {
  const { t } = useI18n();
  const w = t.coachProfile.wizard;
  const router = useRouter();
  const coachError = useCoachError();

  const [draft, setDraft] = useState<Saved>(() => initialDraft(data));
  const saved = useRef<Saved>(initialDraft(data));
  const [services, setServices] = useState<CoachServiceRow[]>(data.services);
  const [certifications, setCertifications] = useState<CoachCertificationRow[]>(data.certifications);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const stepId = STEPS[step];
  const dirtyIdentity = !same(
    [draft.slug, draft.headline, draft.about], [saved.current.slug, saved.current.headline, saved.current.about]);
  const dirtyExpertise = !same(
    [draft.specializations, draft.primarySpecialization, draft.coachingSince],
    [saved.current.specializations, saved.current.primarySpecialization, saved.current.coachingSince]);
  const dirtyWhere = !same(
    [draft.online, draft.inPerson, draft.languages, draft.locations],
    [saved.current.online, saved.current.inPerson, saved.current.languages, saved.current.locations]);
  const dirty = dirtyIdentity || dirtyExpertise || dirtyWhere;

  const idErrors = identityErrors(draft);
  const yearError = coachingSinceError(draft.coachingSince);
  const stepBlocked =
    (stepId === "identity" && Object.keys(idErrors).length > 0) || (stepId === "expertise" && yearError !== null);

  /** Write whatever this step changed. True when nothing is left unsaved. */
  const saveStep = useCallback(async (index: number): Promise<boolean> => {
    if (saving.current) await saving.current;
    const id = STEPS[index];
    const d = draft;
    const s = saved.current;
    const calls: (() => Promise<ActionResult>)[] = [];
    if (id === "identity") {
      const patch: Parameters<typeof saveCoachProfileDraft>[0] = {};
      if (d.slug !== s.slug) patch.slug = d.slug;
      if (d.headline !== s.headline) patch.headline = d.headline;
      if (d.about !== s.about) patch.about = d.about;
      if (Object.keys(patch).length) calls.push(() => saveCoachProfileDraft(patch));
    } else if (id === "expertise") {
      if (!same([d.specializations, d.primarySpecialization], [s.specializations, s.primarySpecialization])) {
        calls.push(() => setCoachSpecializations(d.specializations, d.primarySpecialization));
      }
      if (d.coachingSince !== s.coachingSince) calls.push(() => saveCoachProfileDraft({ coachingSince: d.coachingSince }));
    } else if (id === "where") {
      if (d.online !== s.online || d.inPerson !== s.inPerson) {
        calls.push(() => saveCoachProfileDraft({ online: d.online, inPerson: d.inPerson }));
      }
      if (!same(d.languages, s.languages)) calls.push(() => setCoachLanguages(d.languages));
      if (!same(d.locations, s.locations)) {
        calls.push(() => setCoachLocations(d.locations.map((l) => ({ city: l.city, gymName: l.gymName || null, gymId: l.gymId ?? null }))));
      }
    }
    if (calls.length === 0) return true;

    setSaveState("saving");
    setSaveError(null);
    const run = (async () => {
      for (const call of calls) {
        const result = await call();
        if (!result.ok) {
          setSaveState("error");
          setSaveError(coachError(result));
          return false;
        }
      }
      // What was sent is what is stored now; later keystrokes stay dirty.
      if (id === "identity") saved.current = { ...saved.current, slug: d.slug, headline: d.headline, about: d.about };
      if (id === "expertise") {
        saved.current = { ...saved.current, specializations: d.specializations, primarySpecialization: d.primarySpecialization, coachingSince: d.coachingSince };
      }
      if (id === "where") {
        saved.current = { ...saved.current, online: d.online, inPerson: d.inPerson, languages: d.languages, locations: d.locations };
      }
      setSaveState("saved");
      return true;
    })();
    saving.current = run;
    try {
      return await run;
    } finally {
      saving.current = null;
    }
  }, [draft, coachError]);

  // Debounced autosave for the three field steps: quiet for AUTOSAVE_MS, valid, and changed.
  useEffect(() => {
    if (stepBlocked) return;
    if (!((stepId === "identity" && dirtyIdentity) || (stepId === "expertise" && dirtyExpertise) || (stepId === "where" && dirtyWhere))) return;
    const timer = setTimeout(() => { void saveStep(step); }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, step, stepId, stepBlocked, dirtyIdentity, dirtyExpertise, dirtyWhere, saveStep]);

  // Closing the tab or reloading with an unsaved edit asks first.
  useEffect(() => {
    if (!dirty && saveState !== "saving") return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saveState]);

  // A new step moves focus to its heading, so a keyboard / screen-reader user starts at the top.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    headingRef.current?.focus();
  }, [step]);

  async function goTo(index: number) {
    if (index === step) return;
    if (index > step && stepBlocked) return;
    if (!(await saveStep(step))) return;
    router.push(`${COACH_PROFILE_PATH}?step=${index + 1}`, { scroll: true });
  }

  const checklist: DraftState = {
    ...draft,
    services: services.map((s) => ({ active: s.active, priceUnit: s.price_unit, priceCents: s.price_cents })),
    hasAvatar: Boolean(avatarUrl),
  };
  const touched = stepsTouched(checklist, certifications.length);

  return (
    <Card plain className="p-5 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <Logo size="sm" />
        <p className="text-[13px] font-semibold tabular-nums text-ink-faint" aria-hidden>
          {step + 1} / {STEPS.length}
        </p>
      </div>

      <h1 className="mt-6 font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{w.title}</h1>
      <p className="mt-1.5 text-[14px] text-ink-soft">{w.subtitle}</p>

      <Progress step={step} touched={touched} onGo={goTo} disabledAhead={stepBlocked} />

      <div className="mt-6 border-t border-line pt-6">
        <h2 ref={headingRef} tabIndex={-1} className="font-display text-lg font-bold tracking-tight outline-none">
          {w.steps[stepId]}
        </h2>
        <p className="mt-1 text-[13.5px] text-ink-soft">{t.coachProfile[stepId].intro}</p>

        <div className="mt-5">
          {stepId === "identity" ? (
            <IdentityStep draft={draft} setDraft={setDraft} errors={idErrors} displayName={displayName} />
          ) : stepId === "expertise" ? (
            <ExpertiseStep draft={draft} setDraft={setDraft} catalog={catalog} yearError={yearError} />
          ) : stepId === "where" ? (
            <WhereStep draft={draft} setDraft={setDraft} catalog={catalog} />
          ) : stepId === "certifications" ? (
            <CertificationsStep rows={certifications} onChange={setCertifications} />
          ) : stepId === "services" ? (
            <ServicesStep rows={services} onChange={setServices} />
          ) : (
            <PublishStep
              data={data} draft={draft} services={services} certifications={certifications} catalog={catalog}
              displayName={displayName} avatarUrl={avatarUrl} photoUploads={photoUploads}
              missing={missingFor(checklist)} onGo={goTo}
            />
          )}
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-ink-faint" role="status" aria-live="polite">
          {saveState === "saving" ? w.saving : saveState === "saved" && !dirty ? w.saved : dirty ? w.unsaved : ""}
        </p>
        <div className="flex gap-2">
          {step > 0 ? (
            <button type="button" className={SMALL_BUTTON + " h-11 px-5"} onClick={() => goTo(step - 1)} disabled={saveState === "saving"}>
              {w.back}
            </button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <button type="button" className={BUTTON} onClick={() => goTo(step + 1)} disabled={stepBlocked || saveState === "saving"}>
              {saveState === "saving" ? w.saving : w.continue}
            </button>
          ) : null}
        </div>
      </div>
      {saveError ? <p role="alert" className="mt-2 text-right text-[13px] text-risk">{saveError}</p> : null}
    </Card>
  );
}

// ============================================================================
// progress
// ============================================================================

function Progress({
  step, touched, onGo, disabledAhead,
}: {
  step: number;
  touched: boolean[];
  onGo: (index: number) => void;
  disabledAhead: boolean;
}) {
  const { t } = useI18n();
  const w = t.coachProfile.wizard;
  return (
    <nav aria-label={w.progress} className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{w.progress}</p>
        <p className="text-[12.5px] font-semibold text-ink-soft">{fill(w.stepOf, { n: step + 1, total: STEPS.length })}</p>
      </div>
      <ol className="mt-3 flex items-center">
        {STEPS.map((id, i) => {
          const current = i === step;
          const done = i < step || touched[i];
          return (
            <li key={id} className={`flex items-center ${i < STEPS.length - 1 ? "flex-1" : ""}`}>
              <button
                type="button"
                onClick={() => onGo(i)}
                disabled={i > step && disabledAhead}
                aria-current={current ? "step" : undefined}
                aria-label={`${i + 1}. ${w.steps[id]}`}
                title={w.steps[id]}
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold outline-none ring-accent/50 transition focus-visible:ring-2 ${
                  current ? "bg-accent text-accent-fg" : done ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-faint"
                }`}
              >
                {i + 1}
              </button>
              {i < STEPS.length - 1 ? (
                <span aria-hidden className={`mx-1 h-0.5 flex-1 rounded-full ${i < step ? "bg-accent" : "bg-line"}`} />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ============================================================================
// steps 1–3: fields of the profile itself
// ============================================================================

type StepProps = { draft: Saved; setDraft: React.Dispatch<React.SetStateAction<Saved>> };

function Counter({ n, max }: { n: number; max: number }) {
  const { t } = useI18n();
  return (
    <span className={`text-[12px] tabular-nums ${n > max ? "text-risk" : "text-ink-faint"}`}>
      {fill(t.coachProfile.wizard.counter, { n, max })}
    </span>
  );
}

function IdentityStep({
  draft, setDraft, errors, displayName,
}: StepProps & { errors: ReturnType<typeof identityErrors>; displayName: string }) {
  const { t } = useI18n();
  const c = t.coachProfile.identity;
  const w = t.coachProfile.wizard;
  const ids = useId();
  return (
    <div className="grid gap-5">
      <div>
        <div className="flex items-end justify-between gap-3">
          <label className={LABEL} htmlFor={`${ids}-headline`}>{c.headline}</label>
          <Counter n={draft.headline.trim().length} max={COACH_LIMITS.headline} />
        </div>
        <input
          id={`${ids}-headline`} className={FIELD} value={draft.headline} autoComplete="organization-title"
          aria-invalid={Boolean(errors.headline)} aria-describedby={`${ids}-headline-hint`}
          onChange={(e) => setDraft((d) => ({ ...d, headline: e.target.value }))}
        />
        <p id={`${ids}-headline-hint`} className={HINT}>{c.headlineHint}</p>
        {errors.headline ? <span className={FIELD_ERROR}>{fill(w.tooLong, { max: COACH_LIMITS.headline })}</span> : null}
      </div>

      <div>
        <div className="flex items-end justify-between gap-3">
          <label className={LABEL} htmlFor={`${ids}-about`}>{c.about}</label>
          <Counter n={draft.about.trim().length} max={COACH_LIMITS.about} />
        </div>
        <textarea
          id={`${ids}-about`} className={`${FIELD} h-auto min-h-40 resize-y py-2.5 leading-relaxed`} rows={7}
          value={draft.about} aria-invalid={Boolean(errors.about)} aria-describedby={`${ids}-about-hint`}
          onChange={(e) => setDraft((d) => ({ ...d, about: e.target.value }))}
        />
        <p id={`${ids}-about-hint`} className={HINT}>{c.aboutHint}</p>
        {errors.about ? <span className={FIELD_ERROR}>{fill(w.tooLong, { max: COACH_LIMITS.about })}</span> : null}
      </div>

      <div>
        <label className={LABEL} htmlFor={`${ids}-slug`}>{c.slug}</label>
        <input
          id={`${ids}-slug`} className={FIELD} value={draft.slug} maxLength={COACH_LIMITS.slugMax}
          autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(errors.slug)} aria-describedby={`${ids}-slug-hint`}
          onChange={(e) => setDraft((d) => ({ ...d, slug: slugify(e.target.value) }))}
          onBlur={() => setDraft((d) => ({ ...d, slug: d.slug.replace(/^-+|-+$/g, "") }))}
        />
        <p id={`${ids}-slug-hint`} className={HINT}>{fill(c.slugHint, { slug: draft.slug || "…" })}</p>
        {errors.slug ? <span className={FIELD_ERROR}>{c.slugError}</span> : null}
        <p className={HINT}>{fill(c.shownAs, { name: displayName })}</p>
      </div>
    </div>
  );
}

function ExpertiseStep({
  draft, setDraft, catalog, yearError,
}: StepProps & { catalog: CoachCatalog; yearError: string | null }) {
  const { t, locale } = useI18n();
  const c = t.coachProfile.expertise;
  const ids = useId();
  const [refused, setRefused] = useState(false);
  const thisYear = new Date().getFullYear();
  const years = useMemo(() => Array.from({ length: thisYear - 1950 + 1 }, (_, i) => thisYear - i), [thisYear]);
  const nameOf = (slug: string) => {
    const s = catalog.specializations.find((x) => x.slug === slug);
    return s ? (locale === "ro" ? s.name_ro : s.name_en) : slug;
  };

  return (
    <div className="grid gap-6">
      <fieldset>
        <legend className={LABEL}>{c.specializations}</legend>
        <p className={HINT}>{fill(c.specializationsHint, { max: COACH_LIMITS.specializations })}</p>
        {catalog.specializations.length === 0 ? <p className="mt-3 text-[13px] text-ink-faint">{c.none}</p> : null}
        <div className="mt-3 flex flex-wrap gap-1.5" data-testid="coach-specializations">
          {catalog.specializations.map((s) => {
            const on = draft.specializations.includes(s.slug);
            return (
              <Chip
                key={s.slug} on={on}
                onToggle={() => {
                  const next = toggleSpecialization(draft.specializations, draft.primarySpecialization, s.slug);
                  setRefused(next.refused);
                  if (!next.refused) setDraft((d) => ({ ...d, specializations: next.selected, primarySpecialization: next.primary }));
                }}
              >
                {on && draft.primarySpecialization === s.slug ? <span aria-hidden>★</span> : null}
                {locale === "ro" ? s.name_ro : s.name_en}
              </Chip>
            );
          })}
        </div>
        {refused ? <p role="alert" className={FIELD_ERROR}>{fill(c.maxReached, { max: COACH_LIMITS.specializations })}</p> : null}
        {draft.specializations.length > 1 ? (
          <div className="mt-4">
            <p className={LABEL}>{c.primary}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {draft.specializations.map((slug) => (
                <Chip
                  key={slug} on={draft.primarySpecialization === slug}
                  onToggle={() => setDraft((d) => ({ ...d, primarySpecialization: slug }))}
                >
                  <span className="sr-only">{fill(c.makePrimary, { name: nameOf(slug) })}</span>
                  <span aria-hidden>{draft.primarySpecialization === slug ? "★ " : "☆ "}{nameOf(slug)}</span>
                </Chip>
              ))}
            </div>
          </div>
        ) : null}
      </fieldset>

      <div>
        <label className={LABEL} htmlFor={`${ids}-since`}>{c.coachingSince}</label>
        <select
          id={`${ids}-since`} className={`${FIELD} sm:max-w-56`} value={draft.coachingSince ?? ""}
          aria-invalid={Boolean(yearError)} aria-describedby={`${ids}-since-hint`}
          onChange={(e) => setDraft((d) => ({ ...d, coachingSince: e.target.value ? Number(e.target.value) : null }))}
        >
          <option value="">{c.notSet}</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <p id={`${ids}-since-hint`} className={HINT}>{c.coachingSinceHint}</p>
        {yearError ? <span className={FIELD_ERROR}>{c.yearError}</span> : null}
      </div>
    </div>
  );
}

function WhereStep({ draft, setDraft, catalog }: StepProps & { catalog: CoachCatalog }) {
  const { t, locale } = useI18n();
  const c = t.coachProfile.where;
  const w = t.coachProfile.wizard;
  const ids = useId();
  const [country, setCountry] = useState(catalog.countries[0]?.code ?? "RO");
  const [city, setCity] = useState("");
  const [gym, setGym] = useState("");
  // A gym picked from the shared list (gyms, 20261024100000): "coaches at
  // your gym" finds this profile through it. Typing again unpicks it.
  const [gymId, setGymId] = useState<string | null>(null);
  const [gymHits, setGymHits] = useState<GymHit[]>([]);
  useEffect(() => {
    if (gymId || gym.trim().length < 2) { setGymHits([]); return; }
    let live = true;
    const timer = setTimeout(async () => {
      const found = await searchGyms(gym);
      if (live) setGymHits(found.filter((h) => h.status === "active").slice(0, 5));
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [gym, gymId]);
  const cities = catalog.cities.filter((x) => x.country_code === country && !draft.locations.some((l) => l.city === x.slug));
  const cityName = (slug: string) => {
    const x = catalog.cities.find((y) => y.slug === slug);
    return x ? (locale === "ro" ? x.name : x.name_en ?? x.name) : slug;
  };
  const full = draft.locations.length >= COACH_LIMITS.locations;

  function add() {
    if (!city || full) return;
    setDraft((d) => ({ ...d, locations: [...d.locations, { city, gymName: gym.trim().slice(0, COACH_LIMITS.gymName), gymId }] }));
    setCity("");
    setGym("");
    setGymId(null);
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 rounded-2xl bg-bg p-4">
        <Switch
          checked={draft.online} onChange={(v) => setDraft((d) => ({ ...d, online: v }))}
          label={c.online} hint={c.onlineHint} onLabel={w.on} offLabel={w.off} inset
        />
        <Switch
          checked={draft.inPerson} onChange={(v) => setDraft((d) => ({ ...d, inPerson: v }))}
          label={c.inPerson} hint={c.inPersonHint} onLabel={w.on} offLabel={w.off} inset
        />
      </div>
      {!draft.online && !draft.inPerson ? <p className="-mt-3 text-[13px] text-warn">{c.needMode}</p> : null}

      {/* Online-only coaches need no city; the section appears once in person is on. */}
      {draft.inPerson ? (
        <fieldset>
          <legend className={LABEL}>{c.locations}</legend>
          <p className={HINT}>{fill(c.locationsHint, { max: COACH_LIMITS.locations })}</p>
          {draft.locations.length === 0 ? (
            <p className="mt-3 text-[13px] text-warn">{c.needLocation}</p>
          ) : (
            <ul className="mt-3 grid gap-2" data-testid="coach-locations">
              {draft.locations.map((l) => (
                <li key={l.city} className="flex items-center justify-between gap-3 rounded-2xl bg-bg px-4 py-2.5">
                  <span className="text-[14px]">
                    <span className="font-semibold">{cityName(l.city)}</span>
                    {l.gymName ? <span className="text-ink-faint"> — {l.gymName}</span> : null}
                  </span>
                  <button
                    type="button" className={`${SMALL_BUTTON_INSET} text-risk`}
                    aria-label={fill(c.remove, { city: cityName(l.city) })}
                    onClick={() => setDraft((d) => ({ ...d, locations: d.locations.filter((x) => x.city !== l.city) }))}
                  >×</button>
                </li>
              ))}
            </ul>
          )}
          {full ? (
            <p className={HINT}>{fill(c.max, { max: COACH_LIMITS.locations })}</p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr]">
              <label className={LABEL}>
                {c.country}
                <select className={FIELD} value={country} onChange={(e) => { setCountry(e.target.value); setCity(""); }}>
                  {catalog.countries.map((x) => (
                    <option key={x.code} value={x.code}>{locale === "ro" ? x.name_ro : x.name_en}</option>
                  ))}
                </select>
              </label>
              <label className={LABEL}>
                {c.city}
                <select className={FIELD} value={city} onChange={(e) => setCity(e.target.value)}>
                  <option value="">—</option>
                  {cities.map((x) => (
                    <option key={x.slug} value={x.slug}>{locale === "ro" ? x.name : x.name_en ?? x.name}</option>
                  ))}
                </select>
              </label>
              <label className={`${LABEL} sm:col-span-2`} htmlFor={`${ids}-gym`}>
                {c.gym}
                <input
                  id={`${ids}-gym`} className={FIELD} value={gym} maxLength={COACH_LIMITS.gymName}
                  aria-describedby={`${ids}-gym-hint`}
                  onChange={(e) => { setGym(e.target.value); setGymId(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
                />
              </label>
              {gymId ? (
                <p className={`${HINT} -mt-2 text-accent-ink sm:col-span-2`}>{c.gymLinked}</p>
              ) : gymHits.length > 0 ? (
                <ul className="-mt-2 grid gap-1 sm:col-span-2" aria-label={c.gymSuggestions}>
                  {gymHits.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        className="w-full rounded-xl bg-bg px-3 py-2 text-left text-[13px] hover:bg-accent-soft/40"
                        onClick={() => { setGym(h.name); setGymId(h.id); setGymHits([]); }}
                      >
                        <span className="font-semibold">{h.name}</span>
                        <span className="text-ink-faint"> · {[h.address, h.city].filter(Boolean).join(", ")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p id={`${ids}-gym-hint`} className={`${HINT} -mt-2 sm:col-span-2`}>{c.gymHint}</p>
              <div className="sm:col-span-2">
                <button type="button" className={SMALL_BUTTON} disabled={!city} onClick={add}>{c.add}</button>
              </div>
            </div>
          )}
        </fieldset>
      ) : null}

      <fieldset>
        <legend className={LABEL}>{c.languages}</legend>
        <p className={HINT}>{c.languagesHint}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {catalog.languages.map((l) => {
            const on = draft.languages.includes(l.code);
            return (
              <Chip
                key={l.code} on={on}
                disabled={!on && draft.languages.length >= COACH_LIMITS.languages}
                onToggle={() => setDraft((d) => ({
                  ...d, languages: on ? d.languages.filter((x) => x !== l.code) : [...d.languages, l.code],
                }))}
              >
                {l.native_name}
              </Chip>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}

// ============================================================================
// step 6: photos → preview → submit
// ============================================================================

function PublishStep({
  data, draft, services, certifications, catalog, displayName, avatarUrl, photoUploads, missing, onGo,
}: {
  data: MyCoachProfile;
  draft: Saved;
  services: CoachServiceRow[];
  certifications: CoachCertificationRow[];
  catalog: CoachCatalog;
  displayName: string;
  avatarUrl: string | null;
  photoUploads: boolean;
  missing: CoachProfileMissing[];
  onGo: (index: number) => void;
}) {
  const { t } = useI18n();
  const c = t.coachProfile.publish;
  const router = useRouter();
  const coachError = useCoachError();
  const [submitting, setSubmitting] = useState(false);
  const [serverMissing, setServerMissing] = useState<CoachProfileMissing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // The server's list wins once it has answered; until then, the local mirror.
  const open = serverMissing ?? missing;
  const items = summary(open);
  const ready = open.length === 0;

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await submitCoachForReview();
      if (result.ok) {
        router.replace(COACH_PROFILE_PATH);
        router.refresh();
        return;
      }
      if (result.missing) setServerMissing(result.missing);
      else setError(coachError(result));
    } finally {
      setSubmitting(false);
    }
  }

  const preview = buildPreview({ data, draft, services, certifications, catalog, displayName, avatarUrl });

  return (
    <div className="grid gap-8">
      <section aria-labelledby="coach-photos">
        <h3 id="coach-photos" className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{c.photos}</h3>
        <div className="mt-3 grid gap-5">
          <AvatarPicker name={displayName} url={avatarUrl} enabled={photoUploads} />
          <CoverPicker url={data.profile.cover_url} enabled={photoUploads} />
        </div>
      </section>

      <section aria-labelledby="coach-preview" ref={previewRef}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 id="coach-preview" className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{c.preview}</h3>
            <p className="mt-1 text-[13px] text-ink-soft">{c.previewHint}</p>
          </div>
          <button type="button" className={SMALL_BUTTON} onClick={() => onGo(0)}>{c.editProfile}</button>
        </div>
        <div className="mt-3 rounded-3xl bg-bg p-2 sm:p-3">
          <CoachProfilePreview profile={preview} />
        </div>
      </section>

      <section aria-labelledby="coach-summary" className="rounded-3xl bg-bg p-5" data-testid="coach-submit-summary">
        <h3 id="coach-summary" className="font-display text-lg font-bold tracking-tight">
          {ready ? c.readyTitle : c.notReadyTitle}
        </h3>
        <ul className="mt-3 grid gap-2">
          {items.map((item) => (
            <li key={item.group} className="flex items-center justify-between gap-3 text-[14px]" data-done={item.done}>
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                    item.done ? "bg-accent text-accent-fg" : "bg-surface text-ink-faint"
                  }`}
                >
                  {item.done ? "✓" : ""}
                </span>
                <span className={item.done ? "" : "text-ink-soft"}>{c.groups[item.group]}</span>
              </span>
              {!item.done ? (
                <button
                  type="button" className="text-[13px] font-semibold text-accent-ink hover:underline"
                  onClick={() => onGo(stepForMissing(open.find((m) => groupOf(m) === item.group)!))}
                >
                  {c.fix}
                </button>
              ) : null}
            </li>
          ))}
          {/* optional: worth adding, never required (coach_profile_missing() does not ask for them) */}
          {[
            { key: "certifications", done: certifications.length > 0, label: c.optionalCertifications, step: 3 },
            { key: "cover", done: Boolean(data.profile.cover_url), label: c.optionalCover, step: null },
          ].map((item) => (
            <li key={item.key} className="flex items-center justify-between gap-3 text-[14px]" data-optional data-done={item.done}>
              <span className="flex items-center gap-2">
                <span aria-hidden className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                  item.done ? "bg-accent text-accent-fg" : "border border-line text-ink-faint"}`}>
                  {item.done ? "✓" : ""}
                </span>
                <span className={item.done ? "" : "text-ink-soft"}>
                  {item.label} <span className="text-[12px] text-ink-faint">· {c.optional}</span>
                </span>
              </span>
              {!item.done && item.step !== null ? (
                <button type="button" className="text-[13px] font-semibold text-accent-ink hover:underline" onClick={() => onGo(item.step!)}>
                  {c.add}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        <p className={`${HINT} mt-4`}>{c.submitHint}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={`${SMALL_BUTTON_INSET} h-11 px-5`} onClick={() => onGo(0)}>{c.editProfile}</button>
          <button type="button" className={BUTTON} disabled={!ready || submitting} onClick={submit}>
            {submitting ? c.submitting : c.submit}
          </button>
        </div>
        {error ? <p role="alert" className="mt-2 text-[13px] text-risk">{error}</p> : null}
      </section>
    </div>
  );
}

function groupOf(m: CoachProfileMissing) {
  return summary([m]).find((s) => !s.done)!.group;
}

/** The draft as coach_public_profile() would return it once published. */
export function buildPreview({
  data, draft, services, certifications, catalog, displayName, avatarUrl,
}: {
  data: MyCoachProfile;
  draft: Saved;
  services: CoachServiceRow[];
  certifications: CoachCertificationRow[];
  catalog: CoachCatalog;
  displayName: string;
  avatarUrl: string | null;
}): CoachPublicProfile {
  const country = (code: string) => catalog.countries.find((x) => x.code === code);
  return {
    id: data.profile.id,
    user_id: data.profile.user_id,
    slug: draft.slug,
    display_name: displayName,
    username: null,
    avatar_url: avatarUrl,
    cover_url: data.profile.cover_url,
    headline: draft.headline.trim() || null,
    about: draft.about.trim() || null,
    coaching_since: draft.coachingSince,
    accepting_clients: data.profile.accepting_clients,
    online: draft.online,
    in_person: draft.inPerson,
    published_at: data.profile.published_at,
    followers: 0,
    badges: data.verifications.filter((v) => v.status === "verified").map((v) => `${v.kind}_verified` as const),
    specializations: draft.specializations
      .map((slug) => catalog.specializations.find((s) => s.slug === slug))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => ({ slug: s.slug, name_en: s.name_en, name_ro: s.name_ro, is_primary: s.slug === draft.primarySpecialization }))
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary)),
    languages: draft.languages
      .map((code) => catalog.languages.find((l) => l.code === code))
      .filter((l): l is NonNullable<typeof l> => Boolean(l))
      .map((l) => ({ code: l.code, name_en: l.name_en, name_ro: l.name_ro, native_name: l.native_name })),
    locations: draft.inPerson
      ? draft.locations.flatMap((l) => {
          const city = catalog.cities.find((x) => x.slug === l.city);
          if (!city) return [];
          const co = country(city.country_code);
          return [{
            city_slug: city.slug, city: city.name, city_en: city.name_en ?? city.name, country_code: city.country_code,
            country_en: co?.name_en ?? city.country_code, country_ro: co?.name_ro ?? city.country_code, gym_name: l.gymName || null,
          }];
        })
      : [],
    certifications: certifications.map((c) => ({ name: c.name, issuer: c.issuer, verified: c.verification_status === "verified" })),
    services: services.filter((s) => s.active).map((s) => ({
      id: s.id, name: s.name, description: s.description, kind: s.kind, price_unit: s.price_unit,
      price_public: s.price_public, price_cents: s.price_public ? s.price_cents : null,
      currency: s.price_public ? s.currency : null,
    })),
  };
}

/**
 * The cover photo: the avatar's flow (lib/cloudinary-upload.ts) against its own
 * signed ticket. The picked file shows at once while it uploads.
 */
function CoverPicker({ url, enabled }: { url: string | null; enabled: boolean }) {
  const { t } = useI18n();
  const c = t.coachProfile.publish;
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = local ?? url;

  useEffect(() => () => { if (local) URL.revokeObjectURL(local); }, [local]);

  async function upload(file: File) {
    setError(null);
    const check = checkImage(file);
    if (check) {
      setError(check === "NOT_IMAGE" ? c.notImage : c.tooLarge);
      return;
    }
    setLocal(URL.createObjectURL(file));
    setBusy(true);
    try {
      const permission = await requestCoverUpload();
      if (!permission.ok || !permission.ticket) {
        setError(c.uploadFailed);
        setLocal(null);
        return;
      }
      const uploaded = await uploadSignedImage(permission.ticket, file);
      const saved = uploaded ? await saveCover(uploaded) : null;
      if (!saved?.ok) {
        setError(c.uploadFailed);
        setLocal(null);
        return;
      }
      router.refresh();
    } catch {
      setError(c.uploadFailed);
      setLocal(null);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      const result = await removeCover();
      if (!result.ok) {
        setError(c.uploadFailed);
        return;
      }
      setLocal(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-[13px] font-semibold text-ink-soft">{c.cover}</p>
      <div className="relative mt-2 aspect-[8/3] w-full overflow-hidden rounded-2xl bg-accent-soft">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="" className={`h-full w-full object-cover ${busy ? "opacity-60" : ""}`} />
        ) : null}
        {busy ? (
          <span className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold text-ink">{c.uploading}</span>
        ) : null}
      </div>
      <input
        ref={fileRef} type="file" accept="image/*" className="hidden" aria-label={c.cover}
        onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); }}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {enabled ? (
          <button type="button" className={SMALL_BUTTON} disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? c.uploading : shown ? c.changeCover : c.addCover}
          </button>
        ) : null}
        {url && !busy ? (
          <button type="button" className={`${SMALL_BUTTON} text-ink-soft`} onClick={remove}>{c.removeCover}</button>
        ) : null}
      </div>
      <p className={HINT}>{enabled ? c.coverHint : c.unavailable}</p>
      {error ? <p role="alert" className="mt-1 text-[12.5px] text-risk">{error}</p> : null}
    </div>
  );
}
