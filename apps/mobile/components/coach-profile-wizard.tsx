import type { CoachProfileEditorV1 } from "@healthapp/api/v1";
import {
  CLIENT_GOALS, CONTENT_LIMITS, MAX_CLIENT_GOALS, SOCIAL_NETWORKS, cleanSocialLinks, hasRiskyClaim, type ClientGoal, type SocialLinks,
} from "@healthapp/shared/coach/content";
import {
  STEPS, coachingSinceError, identityErrors, missingFor, slugify, stepForMissing, stepsTouched, summary, toggleSpecialization, type DraftState,
} from "@healthapp/shared/coach/onboarding";
import {
  COACH_LIMITS, type CoachCatalog, type CoachCertificationRow, type CoachProfileMissing, type CoachServiceRow, type MyCoachProfile,
} from "@healthapp/shared/coach/profile";
import { filterTaxonomy, groupSpecializations, specializationName } from "@healthapp/shared/coach/taxonomy";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Image, Pressable, Text, TextInput, View } from "react-native";
import { Chip, Counter, ErrorText, Primary, Section, Small, Tick, useCoachError } from "@/components/coach-profile-bits";
import { CertificationsStep, ServicesStep, useServicePrice } from "@/components/coach-profile-lists";
import { Field, Hint, Label, PhotoPicker, Switch } from "@/components/settings-forms";
import { Card } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The six-step coach profile editor — the web's CoachProfileWizard
// (components/coach-profile/wizard.tsx) on a phone. Only mounted for a draft
// or an open revision. Every step saves through the same actions on Continue,
// Back or a progress dot, and the three text steps also save themselves after
// AUTOSAVE_MS of quiet. The model is the web's own (@healthapp/shared/coach).

const AUTOSAVE_MS = 1500;

type SaveState = "idle" | "saving" | "saved" | "error";

type Saved = Pick<DraftState,
  "slug" | "headline" | "about" | "coachingSince" | "online" | "inPerson" | "specializations" | "primarySpecialization" | "languages" | "locations"> & {
  approach: string;
  experienceSummary: string;
  clientGoals: ClientGoal[];
  socialLinks: SocialLinks;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function initialDraft(data: MyCoachProfile): Saved {
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
    approach: p.approach ?? "",
    experienceSummary: p.experience_summary ?? "",
    clientGoals: p.client_goals ?? [],
    socialLinks: p.social_links ?? {},
  };
}

export function CoachProfileWizard({ page, startStep, documentsMissing, onScrollTop }: {
  page: CoachProfileEditorV1 & { mine: MyCoachProfile };
  startStep: number;
  documentsMissing: CoachProfileMissing[];
  /** A new step starts at the top of the page. */
  onScrollTop: () => void;
}) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const w = t.coachProfile.wizard;
  const coachError = useCoachError();
  const queryClient = useQueryClient();
  const data = page.mine;
  const catalog = page.catalog;

  const [step, setStep] = useState(startStep);
  const [draft, setDraft] = useState<Saved>(() => initialDraft(data));
  const saved = useRef<Saved>(initialDraft(data));
  const [services, setServices] = useState<CoachServiceRow[]>(data.services);
  const [certifications, setCertifications] = useState<CoachCertificationRow[]>(data.certifications);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);

  const stepId = STEPS[step]!;
  const dirtyIdentity = !same([draft.slug, draft.headline, draft.about, draft.socialLinks], [saved.current.slug, saved.current.headline, saved.current.about, saved.current.socialLinks]);
  const dirtyContent = !same([draft.approach, draft.experienceSummary, draft.clientGoals], [saved.current.approach, saved.current.experienceSummary, saved.current.clientGoals]);
  const dirtyExpertise = dirtyContent || !same(
    [draft.specializations, draft.primarySpecialization, draft.coachingSince],
    [saved.current.specializations, saved.current.primarySpecialization, saved.current.coachingSince]);
  const dirtyWhere = !same([draft.online, draft.inPerson, draft.languages, draft.locations], [saved.current.online, saved.current.inPerson, saved.current.languages, saved.current.locations]);
  const dirty = dirtyIdentity || dirtyExpertise || dirtyWhere;

  const idErrors = identityErrors(draft);
  const socialInvalid = cleanSocialLinks(draft.socialLinks).invalid;
  const yearError = coachingSinceError(draft.coachingSince);
  const contentTooLong = draft.approach.trim().length > CONTENT_LIMITS.approach || draft.experienceSummary.trim().length > CONTENT_LIMITS.experienceSummary;
  const stepBlocked = (stepId === "identity" && (Object.keys(idErrors).length > 0 || socialInvalid !== null)) || (stepId === "expertise" && (yearError !== null || contentTooLong));

  /** Write whatever this step changed. True when nothing is left unsaved. */
  const saveStep = useCallback(async (index: number): Promise<boolean> => {
    if (saving.current) await saving.current;
    const id = STEPS[index];
    const d = draft;
    const s = saved.current;
    const calls: [string, Record<string, unknown>][] = [];
    if (id === "identity") {
      const patch: Record<string, unknown> = {};
      if (d.slug !== s.slug) patch.slug = d.slug;
      if (d.headline !== s.headline) patch.headline = d.headline;
      if (d.about !== s.about) patch.about = d.about;
      if (!same(d.socialLinks, s.socialLinks)) patch.socialLinks = cleanSocialLinks(d.socialLinks).links;
      if (Object.keys(patch).length) calls.push(["draft", { fields: patch }]);
    } else if (id === "expertise") {
      if (!same([d.specializations, d.primarySpecialization], [s.specializations, s.primarySpecialization])) {
        calls.push(["specializations", { slugs: d.specializations, primary: d.primarySpecialization }]);
      }
      if (d.coachingSince !== s.coachingSince) calls.push(["draft", { fields: { coachingSince: d.coachingSince } }]);
      if (!same([d.approach, d.experienceSummary, d.clientGoals], [s.approach, s.experienceSummary, s.clientGoals])) {
        calls.push(["draft", { fields: { approach: d.approach, experienceSummary: d.experienceSummary, clientGoals: d.clientGoals } }]);
      }
    } else if (id === "where") {
      if (d.online !== s.online || d.inPerson !== s.inPerson) calls.push(["draft", { fields: { online: d.online, inPerson: d.inPerson } }]);
      if (!same(d.languages, s.languages)) calls.push(["languages", { codes: d.languages }]);
      if (!same(d.locations, s.locations)) {
        calls.push(["locations", { locations: d.locations.map((l) => ({ city: l.city, gymName: l.gymName || null, gymId: l.gymId ?? null })) }]);
      }
    }
    if (calls.length === 0) return true;

    setSaveState("saving");
    setSaveError(null);
    const run = (async () => {
      for (const [op, body] of calls) {
        try {
          const result = await api.coachProfileWrite(op, body);
          if (!result.ok) {
            setSaveState("error");
            setSaveError(coachError(result));
            return false;
          }
        } catch (e) {
          setSaveState("error");
          setSaveError(coachError(e));
          return false;
        }
      }
      // What was sent is what is stored now; later keystrokes stay dirty.
      if (id === "identity") saved.current = { ...saved.current, slug: d.slug, headline: d.headline, about: d.about, socialLinks: d.socialLinks };
      if (id === "expertise") {
        saved.current = {
          ...saved.current, specializations: d.specializations, primarySpecialization: d.primarySpecialization, coachingSince: d.coachingSince,
          approach: d.approach, experienceSummary: d.experienceSummary, clientGoals: d.clientGoals,
        };
      }
      if (id === "where") saved.current = { ...saved.current, online: d.online, inPerson: d.inPerson, languages: d.languages, locations: d.locations };
      setSaveState("saved");
      void queryClient.invalidateQueries({ queryKey: ["coach-marketplace"] });
      return true;
    })();
    saving.current = run;
    try {
      return await run;
    } finally {
      saving.current = null;
    }
  }, [draft, coachError, queryClient]);

  // Debounced autosave for the three field steps: quiet for AUTOSAVE_MS, valid, and changed.
  useEffect(() => {
    if (stepBlocked) return;
    if (!((stepId === "identity" && dirtyIdentity) || (stepId === "expertise" && dirtyExpertise) || (stepId === "where" && dirtyWhere))) return;
    const timer = setTimeout(() => { void saveStep(step); }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, step, stepId, stepBlocked, dirtyIdentity, dirtyExpertise, dirtyWhere, saveStep]);

  async function goTo(index: number) {
    if (index === step) return;
    if (index > step && stepBlocked) return;
    if (!(await saveStep(step))) return;
    setStep(index);
    onScrollTop();
  }

  const checklist: DraftState = {
    ...draft,
    services: services.map((s) => ({ active: s.active, priceUnit: s.price_unit, priceCents: s.price_cents })),
    hasAvatar: Boolean(page.avatar_url),
  };
  const touched = stepsTouched(checklist, certifications.length);
  const setDraftFn: Dispatch<SetStateAction<Saved>> = setDraft;

  return (
    <Card style={{ gap: 0 }}>
      <Text style={{ alignSelf: "flex-end", fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{`${step + 1} / ${STEPS.length}`}</Text>
      <Text style={{ marginTop: 4, fontFamily: font.displayExtrabold, fontSize: 24, color: color.ink }}>{w.title}</Text>
      <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 14, lineHeight: 20, color: color.inkSoft }}>{w.subtitle}</Text>

      {/* progress: a numbered dot per step, the current one gold, a touched one soft gold */}
      <View style={{ marginTop: 18 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Section>{w.progress}</Section>
          <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{fill(w.stepOf, { n: step + 1, total: STEPS.length })}</Text>
        </View>
        <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center" }}>
          {STEPS.map((id, i) => {
            const current = i === step;
            const done = i < step || touched[i];
            return (
              <View key={id} style={[{ flexDirection: "row", alignItems: "center" }, i < STEPS.length - 1 ? { flex: 1 } : null]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${i + 1}. ${w.steps[id]}`}
                  accessibilityState={{ selected: current, disabled: i > step && stepBlocked }}
                  disabled={i > step && stepBlocked}
                  onPress={() => void goTo(i)}
                  style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: current ? color.accent : done ? color.accentSoft : color.bg }}
                >
                  <Text style={{ fontFamily: font.bold, fontSize: 12, color: current ? color.accentFg : done ? color.accentInk : color.inkFaint }}>{i + 1}</Text>
                </Pressable>
                {i < STEPS.length - 1 ? <View style={{ flex: 1, height: 2, marginHorizontal: 4, borderRadius: 1, backgroundColor: i < step ? color.accent : color.line }} /> : null}
              </View>
            );
          })}
        </View>
      </View>

      <View style={{ marginTop: 20, paddingTop: 20, borderTopWidth: 1, borderTopColor: color.line }}>
        <Text accessibilityRole="header" style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{w.steps[stepId]}</Text>
        <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft }}>{t.coachProfile[stepId].intro}</Text>
        <View style={{ marginTop: 18 }}>
          {stepId === "identity" ? (
            <IdentityStep draft={draft} setDraft={setDraftFn} errors={idErrors} displayName={page.display_name} revisionMode={Boolean(data.revision)} socialInvalid={socialInvalid} />
          ) : stepId === "expertise" ? (
            <ExpertiseStep draft={draft} setDraft={setDraftFn} catalog={catalog} yearError={yearError} />
          ) : stepId === "where" ? (
            <WhereStep draft={draft} setDraft={setDraftFn} catalog={catalog} />
          ) : stepId === "certifications" ? (
            <CertificationsStep rows={certifications} onChange={setCertifications} />
          ) : stepId === "services" ? (
            <ServicesStep rows={services} onChange={setServices} />
          ) : (
            <PublishStep
              page={page} draft={draft} services={services} certifications={certifications}
              missing={[...missingFor(checklist), ...documentsMissing]} onGo={(i) => void goTo(i)} onScrollTop={onScrollTop}
            />
          )}
        </View>
      </View>

      <View style={{ marginTop: 24, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <Text accessibilityLiveRegion="polite" style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
          {saveState === "saving" ? w.saving : saveState === "saved" && !dirty ? w.saved : dirty ? w.unsaved : ""}
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {step > 0 ? <Small label={w.back} disabled={saveState === "saving"} onPress={() => void goTo(step - 1)} style={{ height: 44, borderRadius: 14, paddingHorizontal: 18 }} /> : null}
          {step < STEPS.length - 1 ? (
            <Primary label={saveState === "saving" ? w.saving : w.continue} disabled={stepBlocked || saveState === "saving"} onPress={() => void goTo(step + 1)} />
          ) : null}
        </View>
      </View>
      {saveError ? <ErrorText>{saveError}</ErrorText> : null}
    </Card>
  );
}

// ---------- steps 1–3: fields of the profile itself ----------

type StepProps = { draft: Saved; setDraft: Dispatch<SetStateAction<Saved>> };

/** A labelled text area with its counter and the claims nudge (ContentArea). */
function Area({ label, hint, max, value, onChange, tall }: { label: string; hint: string; max: number; value: string; onChange: (v: string) => void; tall?: boolean }) {
  const { t, fill } = useI18n();
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
        <Label>{label}</Label>
        <Counter n={value.trim().length} max={max} />
      </View>
      <Field label="" a11y={label} value={value} onChange={onChange} multiline tall={tall} />
      <Hint>{hint}</Hint>
      {value.trim().length > max ? <ErrorText>{fill(t.coachProfile.wizard.tooLong, { max })}</ErrorText> : null}
      <ClaimNudge text={value} />
    </View>
  );
}

/** A quiet warning under a text that promises what nobody can (hasRiskyClaim). */
function ClaimNudge({ text }: { text: string }) {
  const { t } = useI18n();
  const { color } = useTheme();
  if (!hasRiskyClaim(text)) return null;
  return <Text style={{ marginTop: 6, fontFamily: font.semibold, fontSize: 12.5, lineHeight: 18, color: color.warn }}>{t.coachProfile.expertise.claimWarning}</Text>;
}

function IdentityStep({ draft, setDraft, errors, displayName, revisionMode, socialInvalid }: StepProps & {
  errors: ReturnType<typeof identityErrors>; displayName: string; revisionMode: boolean; socialInvalid: (typeof SOCIAL_NETWORKS)[number] | null;
}) {
  const { t, fill } = useI18n();
  const c = t.coachProfile.identity;
  const w = t.coachProfile.wizard;
  return (
    <View style={{ gap: 20 }}>
      <View>
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
          <Label>{c.headline}</Label>
          <Counter n={draft.headline.trim().length} max={COACH_LIMITS.headline} />
        </View>
        <Field label="" a11y={c.headline} value={draft.headline} onChange={(v) => setDraft((d) => ({ ...d, headline: v }))} />
        <Hint>{c.headlineHint}</Hint>
        {errors.headline ? <ErrorText>{fill(w.tooLong, { max: COACH_LIMITS.headline })}</ErrorText> : null}
      </View>
      <Area label={c.about} hint={c.aboutHint} max={COACH_LIMITS.about} value={draft.about} tall onChange={(v) => setDraft((d) => ({ ...d, about: v }))} />
      <View>
        <Field label={c.slug} value={draft.slug} plain maxLength={COACH_LIMITS.slugMax} editable={!revisionMode}
          onChange={(v) => setDraft((d) => ({ ...d, slug: slugify(v) }))}
          onBlur={() => setDraft((d) => ({ ...d, slug: d.slug.replace(/^-+|-+$/g, "") }))} />
        <Hint>{revisionMode ? t.coachProfile.status.revision.slugLocked : fill(c.slugHint, { slug: draft.slug || "…" })}</Hint>
        {errors.slug ? <ErrorText>{c.slugError}</ErrorText> : null}
        <Hint>{fill(c.shownAs, { name: displayName })}</Hint>
      </View>
      <View>
        <Label>{c.socialTitle}</Label>
        <Hint>{c.socialHint}</Hint>
        <View style={{ marginTop: 8, gap: 10 }}>
          {SOCIAL_NETWORKS.map((network) => (
            <Field key={network} label={c.socialNetworks[network]} value={draft.socialLinks[network] ?? ""} placeholder={c.socialPlaceholders[network]} plain
              keyboardType={network === "website" ? "url" : "default"} maxLength={network === "website" ? 200 : 120}
              onChange={(v) => setDraft((d) => ({ ...d, socialLinks: { ...d.socialLinks, [network]: v } }))} />
          ))}
        </View>
        {socialInvalid ? <ErrorText>{fill(c.socialError, { network: c.socialNetworks[socialInvalid] })}</ErrorText> : null}
      </View>
    </View>
  );
}

function ExpertiseStep({ draft, setDraft, catalog, yearError }: StepProps & { catalog: CoachCatalog; yearError: string | null }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const c = t.coachProfile.expertise;
  const x = t.coachProfile.taxonomy;
  const [refused, setRefused] = useState(false);
  const [query, setQuery] = useState("");
  const [year, setYear] = useState(draft.coachingSince ? String(draft.coachingSince) : "");
  const nameOf = (slug: string) => {
    const s = catalog.specializations.find((e) => e.slug === slug);
    return s ? specializationName(s, locale) : slug;
  };
  const isOn = (slug: string) => draft.specializations.includes(slug);
  // a picked entry is never hidden by the search (specialization-chips.tsx)
  const matched = useMemo(() => filterTaxonomy(catalog.specializations, query), [catalog.specializations, query]);
  const groups = useMemo(() => {
    const kept = new Set(matched.map((e) => e.slug));
    return groupSpecializations(catalog.specializations.filter((e) => kept.has(e.slug) || draft.specializations.includes(e.slug)));
  }, [catalog.specializations, matched, draft.specializations]);

  const toggle = (slug: string) => {
    const next = toggleSpecialization(draft.specializations, draft.primarySpecialization, slug);
    setRefused(next.refused);
    if (!next.refused) setDraft((d) => ({ ...d, specializations: next.selected, primarySpecialization: next.primary }));
  };
  const chip = (e: { slug: string; name_en: string; name_ro: string }) => (
    <Chip key={e.slug} on={isOn(e.slug)} onPress={() => toggle(e.slug)}
      label={`${isOn(e.slug) && draft.primarySpecialization === e.slug ? "★ " : ""}${specializationName(e, locale)}`} />
  );

  return (
    <View style={{ gap: 22 }}>
      <View>
        <Label>{c.specializations}</Label>
        <Hint>{fill(c.specializationsHint, { max: COACH_LIMITS.specializations })}</Hint>
        {catalog.specializations.length === 0 ? <Hint>{c.none}</Hint> : null}
        <Text style={{ marginTop: 8, fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>
          {fill(x.selectedCount, { n: draft.specializations.length, max: COACH_LIMITS.specializations })}
        </Text>
        {catalog.specializations.length >= 14 ? (
          <TextInput value={query} onChangeText={setQuery} placeholder={x.searchPlaceholder} placeholderTextColor={color.inkFaint} accessibilityLabel={x.searchLabel}
            autoCapitalize="none" autoCorrect={false}
            style={{ marginTop: 8, height: 44, borderRadius: 12, borderWidth: 1, borderColor: color.line, backgroundColor: color.bg, paddingHorizontal: 12, fontFamily: font.regular, fontSize: 14, color: color.ink }} />
        ) : null}
        {matched.length === 0 && query.trim() ? (
          <Text style={{ marginTop: 8, fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>
            {`${fill(x.noMatch, { q: query })} `}
            <Text accessibilityRole="button" onPress={() => setQuery("")} style={{ fontFamily: font.semibold, color: color.accentInk }}>{x.clearSearch}</Text>
          </Text>
        ) : null}
        <View style={{ marginTop: 10, gap: 14 }}>
          {groups.map((g) => (
            <View key={g.category}>
              <Text style={{ fontFamily: font.bold, fontSize: 11.5, letterSpacing: 1.2, textTransform: "uppercase", color: color.inkFaint }}>{x.groups[g.category]}</Text>
              {g.items.some((i) => i.styles.length === 0) ? (
                <View style={{ marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{g.items.filter((i) => i.styles.length === 0).map((i) => chip(i.entry))}</View>
              ) : null}
              {g.items.filter((i) => i.styles.length > 0).map((i) => (
                <View key={i.entry.slug} style={{ marginTop: 8, alignItems: "flex-start" }}>
                  {chip(i.entry)}
                  <View style={{ marginLeft: 12, marginTop: 6, paddingLeft: 10, borderLeftWidth: 1, borderLeftColor: color.line, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{i.styles.map(chip)}</View>
                </View>
              ))}
            </View>
          ))}
        </View>
        {refused ? <ErrorText>{fill(c.maxReached, { max: COACH_LIMITS.specializations })}</ErrorText> : null}
        {draft.specializations.length > 1 ? (
          <View style={{ marginTop: 14 }}>
            <Label>{c.primary}</Label>
            <View style={{ marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {draft.specializations.map((slug) => (
                <Chip key={slug} on={draft.primarySpecialization === slug} onPress={() => setDraft((d) => ({ ...d, primarySpecialization: slug }))}
                  label={`${draft.primarySpecialization === slug ? "★" : "☆"} ${nameOf(slug)}`} />
              ))}
            </View>
          </View>
        ) : null}
      </View>

      <View>
        {/* a year typed (empty = not set); the web's select runs 1950 → this year */}
        <Field label={c.coachingSince} value={year} placeholder={c.notSet} keyboardType="number-pad" plain maxLength={4}
          onChange={(v) => {
            const digits = v.replace(/\D/g, "");
            setYear(digits);
            if (digits === "") setDraft((d) => ({ ...d, coachingSince: null }));
            else if (digits.length === 4) setDraft((d) => ({ ...d, coachingSince: Number(digits) }));
          }} />
        <Hint>{c.coachingSinceHint}</Hint>
        {yearError || (year.length > 0 && year.length < 4) ? <ErrorText>{c.yearError}</ErrorText> : null}
      </View>

      <Area label={c.experienceSummary} hint={c.experienceSummaryHint} max={CONTENT_LIMITS.experienceSummary} value={draft.experienceSummary}
        onChange={(v) => setDraft((d) => ({ ...d, experienceSummary: v }))} />
      <Area label={c.approach} hint={c.approachHint} max={CONTENT_LIMITS.approach} value={draft.approach} onChange={(v) => setDraft((d) => ({ ...d, approach: v }))} />

      <View>
        <Label>{c.clientGoals}</Label>
        <Hint>{fill(c.clientGoalsHint, { max: MAX_CLIENT_GOALS })}</Hint>
        <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {CLIENT_GOALS.map((goal) => {
            const on = draft.clientGoals.includes(goal);
            const full = !on && draft.clientGoals.length >= MAX_CLIENT_GOALS;
            return (
              <Chip key={goal} on={on} label={c.goals[goal]} onPress={() => {
                if (full) return;
                setDraft((d) => ({ ...d, clientGoals: on ? d.clientGoals.filter((g) => g !== goal) : [...d.clientGoals, goal] }));
              }} />
            );
          })}
        </View>
        {draft.clientGoals.length >= MAX_CLIENT_GOALS ? <Hint>{fill(c.clientGoalsMax, { max: MAX_CLIENT_GOALS })}</Hint> : null}
      </View>
    </View>
  );
}

type GymHit = { id: string; name: string; city: string; address: string | null };
const gymWhere = (address: string | null, city: string | null) => {
  // lib/gym-map.ts gymWhere: the street, and the city unless the street already says it
  const a = address?.trim() ?? "";
  const c = city?.trim() ?? "";
  if (!a) return c;
  if (!c || a.toLocaleLowerCase("ro").includes(c.toLocaleLowerCase("ro"))) return a;
  return `${a}, ${c}`;
};

function WhereStep({ draft, setDraft, catalog }: StepProps & { catalog: CoachCatalog }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const c = t.coachProfile.where;
  const w = t.coachProfile.wizard;
  const [country, setCountry] = useState(catalog.countries[0]?.code ?? "RO");
  const [city, setCity] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [gym, setGym] = useState("");
  const [gymId, setGymId] = useState<string | null>(null);
  const [gymHits, setGymHits] = useState<GymHit[]>([]);
  useEffect(() => {
    if (gymId || gym.trim().length < 2) { setGymHits([]); return; }
    let live = true;
    const timer = setTimeout(async () => {
      const found = await api.searchGyms(gym).catch(() => []);
      if (live) setGymHits(found.filter((h) => (h.status ?? "active") === "active").slice(0, 5));
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [gym, gymId]);
  const cityName = (slug: string) => {
    const x = catalog.cities.find((y) => y.slug === slug);
    return x ? (locale === "ro" ? x.name : x.name_en ?? x.name) : slug;
  };
  const cities = catalog.cities.filter((x) => x.country_code === country && !draft.locations.some((l) => l.city === x.slug));
  const q = cityQuery.trim().toLocaleLowerCase(locale === "ro" ? "ro" : "en");
  const shownCities = (q ? cities.filter((x) => `${x.name} ${x.name_en ?? ""}`.toLocaleLowerCase("ro").includes(q)) : cities).slice(0, 12);
  const full = draft.locations.length >= COACH_LIMITS.locations;

  function add() {
    if (!city || full) return;
    setDraft((d) => ({ ...d, locations: [...d.locations, { city, gymName: gym.trim().slice(0, COACH_LIMITS.gymName), gymId }] }));
    setCity("");
    setCityQuery("");
    setGym("");
    setGymId(null);
  }

  return (
    <View style={{ gap: 22 }}>
      <View style={{ borderRadius: 16, padding: 14, backgroundColor: color.bg, gap: 14 }}>
        <Switch label={c.online} hint={c.onlineHint} value={draft.online} onChange={(v) => setDraft((d) => ({ ...d, online: v }))} onLabel={w.on} offLabel={w.off} />
        <Switch label={c.inPerson} hint={c.inPersonHint} value={draft.inPerson} onChange={(v) => setDraft((d) => ({ ...d, inPerson: v }))} onLabel={w.on} offLabel={w.off} />
      </View>
      {!draft.online && !draft.inPerson ? <Text style={{ marginTop: -10, fontFamily: font.regular, fontSize: 13, color: color.warn }}>{c.needMode}</Text> : null}

      {draft.inPerson ? (
        <View>
          <Label>{c.locations}</Label>
          <Hint>{fill(c.locationsHint, { max: COACH_LIMITS.locations })}</Hint>
          {draft.locations.length === 0 ? (
            <Text style={{ marginTop: 10, fontFamily: font.regular, fontSize: 13, color: color.warn }}>{c.needLocation}</Text>
          ) : draft.locations.map((l) => (
            <View key={l.city} style={{ marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: color.bg }}>
              <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 14, color: color.inkFaint }}>
                <Text style={{ fontFamily: font.semibold, color: color.ink }}>{cityName(l.city)}</Text>
                {l.gymName ? ` — ${l.gymName}` : ""}
              </Text>
              <Text accessibilityRole="button" accessibilityLabel={fill(c.remove, { city: cityName(l.city) })}
                onPress={() => setDraft((d) => ({ ...d, locations: d.locations.filter((x) => x.city !== l.city) }))}
                style={{ paddingHorizontal: 8, fontFamily: font.bold, fontSize: 18, color: color.risk }}>×</Text>
            </View>
          ))}
          {full ? <Hint>{fill(c.max, { max: COACH_LIMITS.locations })}</Hint> : (
            <View style={{ marginTop: 12, gap: 12 }}>
              {catalog.countries.length > 1 ? (
                <View>
                  <Label>{c.country}</Label>
                  <View style={{ marginTop: 6, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {catalog.countries.map((x) => (
                      <Chip key={x.code} on={country === x.code} label={locale === "ro" ? x.name_ro : x.name_en} onPress={() => { setCountry(x.code); setCity(""); }} />
                    ))}
                  </View>
                </View>
              ) : null}
              <View>
                <Field label={c.city} value={city ? cityName(city) : cityQuery} placeholder="—"
                  onChange={(v) => { setCity(""); setCityQuery(v); }} />
                {!city ? (
                  <View style={{ marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {shownCities.map((x) => <Chip key={x.slug} on={false} label={locale === "ro" ? x.name : x.name_en ?? x.name} onPress={() => setCity(x.slug)} />)}
                  </View>
                ) : null}
              </View>
              <View>
                <Field label={c.gym} value={gym} maxLength={COACH_LIMITS.gymName} onChange={(v) => { setGym(v); setGymId(null); }} />
                {gymId ? (
                  <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 12.5, color: color.accentInk }}>{c.gymLinked}</Text>
                ) : gymHits.length > 0 ? (
                  <View accessibilityLabel={c.gymSuggestions} style={{ marginTop: 6, gap: 4 }}>
                    {gymHits.map((h) => (
                      <Pressable key={h.id} accessibilityRole="button" onPress={() => { setGym(h.name); setGymId(h.id); setGymHits([]); }}
                        style={{ borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: color.bg }}>
                        <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>
                          <Text style={{ fontFamily: font.semibold, color: color.ink }}>{h.name}</Text>
                          {` · ${gymWhere(h.address, h.city)}`}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <Hint>{c.gymHint}</Hint>
              </View>
              <View style={{ alignSelf: "flex-start" }}><Small label={c.add} disabled={!city} onPress={add} /></View>
            </View>
          )}
        </View>
      ) : null}

      <View>
        <Label>{c.languages}</Label>
        <Hint>{c.languagesHint}</Hint>
        <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {catalog.languages.map((l) => {
            const on = draft.languages.includes(l.code);
            return (
              <Chip key={l.code} on={on} label={l.native_name} disabled={!on && draft.languages.length >= COACH_LIMITS.languages}
                onPress={() => setDraft((d) => ({ ...d, languages: on ? d.languages.filter((x) => x !== l.code) : [...d.languages, l.code] }))} />
            );
          })}
        </View>
      </View>
    </View>
  );
}

// ---------- step 6: photos → preview → submit ----------

function groupOf(m: CoachProfileMissing) {
  return summary([m]).find((s) => !s.done)!.group;
}

function PublishStep({ page, draft, services, certifications, missing, onGo, onScrollTop }: {
  page: CoachProfileEditorV1 & { mine: MyCoachProfile };
  draft: Saved;
  services: CoachServiceRow[];
  certifications: CoachCertificationRow[];
  missing: CoachProfileMissing[];
  onGo: (index: number) => void;
  onScrollTop: () => void;
}) {
  const { t } = useI18n();
  const { color } = useTheme();
  const c = t.coachProfile.publish;
  const coachError = useCoachError();
  const queryClient = useQueryClient();
  const data = page.mine;
  const [submitting, setSubmitting] = useState(false);
  const [serverMissing, setServerMissing] = useState<CoachProfileMissing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // the server's list wins once it has answered; until then, the local mirror
  const open = serverMissing ?? missing;
  const items = summary(open);
  const ready = open.length === 0;

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.coachProfileWrite("submit");
      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey: ["coach-profile"] });
        void queryClient.invalidateQueries({ queryKey: ["coach-marketplace"] });
        onScrollTop();
        return;
      }
      if (result.missing) setServerMissing(result.missing);
      else setError(coachError(result));
    } catch (e) {
      setError(coachError(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={{ gap: 26 }}>
      <View style={{ gap: 18 }}>
        <Section>{c.photos}</Section>
        <PhotoPicker kind="avatar" url={page.avatar_url} name={page.display_name} enabled={page.uploads} />
        <PhotoPicker kind="cover" url={data.profile.cover_url} name={page.display_name} enabled={page.uploads && !data.revision} />
        {data.revision ? <Hint>{t.coachProfile.status.revision.coverLocked}</Hint> : null}
      </View>

      <View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
          <View style={{ flexShrink: 1 }}>
            <Section>{c.preview}</Section>
            <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{c.previewHint}</Text>
          </View>
          <Small label={c.editProfile} onPress={() => onGo(0)} />
        </View>
        <View style={{ marginTop: 10, borderRadius: 24, padding: 8, backgroundColor: color.bg }}>
          <Preview page={page} draft={draft} services={services} certifications={certifications} />
        </View>
      </View>

      <View style={{ borderRadius: 24, padding: 18, backgroundColor: color.bg }}>
        <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{ready ? c.readyTitle : c.notReadyTitle}</Text>
        <View style={{ marginTop: 12, gap: 10 }}>
          {items.map((item) => (
            <View key={item.group} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}>
                <Tick done={item.done} />
                <Text style={{ fontFamily: font.regular, fontSize: 14, color: item.done ? color.ink : color.inkSoft }}>{c.groups[item.group]}</Text>
              </View>
              {!item.done ? (
                <Text accessibilityRole="button" style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}
                  // the documents live on the application card above the editor, not in a step
                  onPress={() => (item.group === "verification" ? onScrollTop() : onGo(stepForMissing(open.find((m) => groupOf(m) === item.group)!)))}>
                  {c.fix}
                </Text>
              ) : null}
            </View>
          ))}
          {[
            { key: "certifications", done: certifications.length > 0, label: c.optionalCertifications, step: 3 as number | null },
            { key: "cover", done: Boolean(data.profile.cover_url), label: c.optionalCover, step: null },
          ].map((item) => (
            <View key={item.key} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}>
                <Tick done={item.done} optional />
                <Text style={{ fontFamily: font.regular, fontSize: 14, color: item.done ? color.ink : color.inkSoft }}>
                  {item.label}
                  <Text style={{ fontSize: 12, color: color.inkFaint }}>{` · ${c.optional}`}</Text>
                </Text>
              </View>
              {!item.done && item.step !== null ? (
                <Text accessibilityRole="button" onPress={() => onGo(item.step!)} style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{c.add}</Text>
              ) : null}
            </View>
          ))}
        </View>
        <Hint>{c.submitHint}</Hint>
        <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Small label={c.editProfile} onPress={() => onGo(0)} style={{ height: 44, borderRadius: 14, paddingHorizontal: 18 }} />
          <Primary label={submitting ? c.submitting : data.revision ? t.coachProfile.status.revision.submit : c.submit} disabled={!ready} busy={submitting} onPress={() => void submit()} />
        </View>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </View>
    </View>
  );
}

/** The draft as its public page would read once published (buildPreview + CoachProfilePreview, compact). */
function Preview({ page, draft, services, certifications }: {
  page: CoachProfileEditorV1 & { mine: MyCoachProfile }; draft: Saved; services: CoachServiceRow[]; certifications: CoachCertificationRow[];
}) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const p = t.coachProfile.preview;
  const priceText = useServicePrice();
  const profile = page.mine.profile;
  const cat = page.catalog;
  const specs = draft.specializations
    .map((slug) => cat.specializations.find((s) => s.slug === slug))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .sort((a, b) => Number(b.slug === draft.primarySpecialization) - Number(a.slug === draft.primarySpecialization));
  const languages = draft.languages.map((code) => cat.languages.find((l) => l.code === code)?.native_name).filter(Boolean);
  const locations = draft.inPerson ? draft.locations.flatMap((l) => {
    const city = cat.cities.find((x) => x.slug === l.city);
    if (!city) return [];
    return [`${locale === "ro" ? city.name : city.name_en ?? city.name}${l.gymName ? ` — ${l.gymName}` : ""}`];
  }) : [];
  const years = draft.coachingSince ? new Date().getFullYear() - draft.coachingSince : null;
  const heading = (s: string) => <Text style={{ marginTop: 16, fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: color.inkFaint }}>{s}</Text>;

  return (
    <View style={{ borderRadius: 18, overflow: "hidden", backgroundColor: color.surface }}>
      <View style={{ width: "100%", aspectRatio: 8 / 3, backgroundColor: color.accentSoft }}>
        {profile.cover_url ? <Image source={{ uri: profile.cover_url }} style={{ width: "100%", height: "100%" }} /> : null}
      </View>
      <View style={{ padding: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          {page.avatar_url ? <Image source={{ uri: page.avatar_url }} style={{ width: 56, height: 56, borderRadius: 28 }} /> : (
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: font.displayBold, fontSize: 22, color: color.accentInk }}>{[...page.display_name.trim()][0]?.toUpperCase() ?? "?"}</Text>
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: font.displayExtrabold, fontSize: 19, color: color.ink }}>{page.display_name}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: draft.headline.trim() ? color.inkSoft : color.inkFaint }}>{draft.headline.trim() || p.noHeadline}</Text>
          </View>
        </View>
        <Text style={{ marginTop: 10, fontFamily: font.semibold, fontSize: 12, color: profile.accepting_clients ? color.accentInk : color.inkFaint }}>
          {[profile.accepting_clients ? p.accepting : p.notAccepting, draft.online ? p.online : null, draft.inPerson ? p.inPerson : null,
            years && years > 0 ? fill(p.years, { n: years }) : draft.coachingSince ? fill(p.since, { year: draft.coachingSince }) : null].filter(Boolean).join(" · ")}
        </Text>
        {specs.length ? (
          <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {specs.map((s) => (
              <View key={s.slug} style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: s.slug === draft.primarySpecialization ? color.accentSoft : color.bg }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 12, color: s.slug === draft.primarySpecialization ? color.accentInk : color.inkSoft }}>{specializationName(s, locale)}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {heading(p.about)}
        <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: draft.about.trim() ? color.ink : color.inkFaint }}>{draft.about.trim() || p.noAbout}</Text>
        {locations.length ? <>{heading(p.locations)}<Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, color: color.inkSoft }}>{locations.join("\n")}</Text></> : null}
        {languages.length ? <>{heading(p.languages)}<Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, color: color.inkSoft }}>{languages.join(", ")}</Text></> : null}
        {services.some((s) => s.active) ? (
          <>
            {heading(p.services)}
            {services.filter((s) => s.active).map((s) => (
              <View key={s.id} style={{ marginTop: 8, borderRadius: 14, padding: 12, backgroundColor: color.bg }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{s.name}</Text>
                {s.description ? <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>{s.description}</Text> : null}
                <Text style={{ marginTop: 4, fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{priceText(s)}</Text>
              </View>
            ))}
          </>
        ) : null}
        {certifications.length ? (
          <>
            {heading(p.certifications)}
            <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft }}>
              {certifications.map((c) => [c.name, c.issuer, c.year].filter(Boolean).join(" · ")).join("\n")}
            </Text>
          </>
        ) : null}
      </View>
    </View>
  );
}
