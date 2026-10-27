import type { OnboardingV1 } from "@healthapp/api/v1";
import { CLIENT_GOALS, type ClientGoal } from "@healthapp/shared/coach/content";
import {
  openingStep, setupProgress, type Audience, type SetupFacts, type SetupStep, type StepStatus,
} from "@healthapp/shared/onboarding";
import { router, useLocalSearchParams } from "expo-router";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Chip, ErrorText, Primary, Small } from "@/components/coach-profile-bits";
import { InviteCode, JoinCode } from "@/components/invite-code";
import { Field, PhotoPicker, Pills } from "@/components/settings-forms";
import { Card, NavIcon } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useOnboarding } from "@/lib/onboarding";
import { font, useTheme } from "@/lib/theme";

// Onboarding — the web's /onboarding (components/onboarding/flow.tsx) on a
// phone: the welcome cards, then the setup steps, then a short summary. Every
// step is optional and every screen has a way out ("Finish later"); where the
// person stopped is the next unanswered step (setupProgress), on any device.
// Nothing here is a second profile form: the photo is the account's own
// picker, units and zone go through updateAccount, the code box is JoinCode,
// the invite is InviteCode, and the coach's public page is the profile editor.
// ?intro=1 replays the welcome cards ("Getting started"); ?step=<id> opens one step.

type Phase = "intro" | "setup" | "finish";

/** What a person picks as their own goal: the coaches' goal codes, minus "complete beginners" (who you are, not what you want). */
const GOAL_CHOICES = CLIENT_GOALS.filter((g) => g !== "beginners");

const CARD_ICONS = {
  client: [
    "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
    "M2 10v4M22 10v4M5 8v8M19 8v8M8 6v12M16 6v12M8 12h8",
    "M3 12h18a9 9 0 0 1-18 0zM8 12c0-3 2-5 5-6 2 2 3 4 1 6",
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2 20a7 7 0 0 1 14 0M17 11a3 3 0 0 0 0-6M18 20h4a6 6 0 0 0-3-5.2",
    "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M15.5 8.5l-2 5-5 2 2-5z",
  ],
  coach: [
    "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
    "M4 5h7v6H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 13h7v6H4z",
    "M4 5h11a2 2 0 0 1 2 2v13H6a2 2 0 0 1-2-2zM17 20h3V6a2 2 0 0 0-2-2h-1M8 9h5M8 13h5",
    "M3 9l2-5h14l2 5M3 9h18M3 9v11h18V9M9 20v-6h6v6",
    "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M15.5 8.5l-2 5-5 2 2-5z",
  ],
} as const;

const CHECK = "M5 12.5l4.5 4.5L19 7.5";

/** Where "Finish later" and the summary lead: Today for a client, the dashboard for a coach. */
const homeOf = (audience: Audience) => (audience === "client" ? "/" : "/clients");

export default function Onboarding() {
  const { color } = useTheme();
  const { data, query } = useOnboarding();
  const params = useLocalSearchParams<{ intro?: string; step?: string }>();
  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {data ? (
          <Flow data={data} intro={params.intro === "1"} step={params.step ?? null} />
        ) : query.isError ? (
          <Failed onRetry={() => void query.refetch()} />
        ) : (
          <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Failed({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: useTheme().color.ink }}>{t.mobile.errors.generic}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Small label={t.mobile.today.retry} onPress={onRetry} />
        <Small label={t.onboarding.setup.later} onPress={() => router.replace("/")} />
      </View>
    </Card>
  );
}

function Flow({ data, intro, step }: { data: OnboardingV1; intro: boolean; step: string | null }) {
  // the phase and step are decided once, on arrival, as the web's page does
  const [start] = useState(() => {
    const known = data.state ?? {};
    const progress = setupProgress(data.audience, data.facts as SetupFacts, known);
    const phase: Phase = intro || known.welcome === undefined ? "intro" : progress.answered && !step ? "finish" : "setup";
    return { phase, index: openingStep(data.audience, progress, step) };
  });
  const [phase, setPhase] = useState<Phase>(start.phase);
  const [index, setIndex] = useState(start.index);

  if (phase === "intro") return <Intro audience={data.audience} onDone={() => setPhase("setup")} />;
  if (phase === "finish") {
    return <Finish data={data} onOpen={(i) => { setIndex(i); setPhase("setup"); }} />;
  }
  return <Setup data={data} index={index} onIndex={setIndex} onFinish={() => setPhase("finish")} />;
}

// ---------- the welcome cards ----------

function Intro({ audience, onDone }: { audience: Audience; onDone: () => void }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const w = t.onboarding.welcome;
  const cards = w[audience];
  const { state, mark } = useOnboarding();
  const [i, setI] = useState(0);
  const card = cards[i]!;
  const last = i === cards.length - 1;

  function leave(how: "done" | "skipped") {
    // a replay from "Getting started" leaves the first answer as it was
    if (state?.welcome === undefined) void mark("welcome", how);
    onDone();
  }

  return (
    <View accessibilityLabel={w.region} style={{ gap: 14 }}>
      <View style={styles.between}>
        <Text style={[styles.eyebrow, { color: color.accentInk }]}>{w.eyebrow}</Text>
        <Text accessibilityRole="button" onPress={() => leave("skipped")} style={[styles.quiet, { color: color.inkFaint }]}>{w.skip}</Text>
      </View>
      <Card style={{ gap: 0, padding: 22 }}>
        <View accessibilityLabel={fill(w.cardOf, { n: i + 1, total: cards.length })}>
          <View style={[styles.iconBox, { backgroundColor: color.accentSoft }]}>
            <NavIcon d={CARD_ICONS[audience][i] ?? CARD_ICONS[audience][0]} size={28} color={color.accentInk} />
          </View>
          <Text accessibilityRole="header" style={[styles.h1, { color: color.ink }]}>{card.title}</Text>
          <Text style={[styles.why, { color: color.inkSoft }]}>{card.body}</Text>
          <View style={{ marginTop: 18, gap: 10 }}>
            {card.points.map((p) => (
              <View key={p} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <NavIcon d={CHECK} size={18} color={color.accentInk} />
                <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 14, lineHeight: 19, color: color.ink }}>{p}</Text>
              </View>
            ))}
          </View>
        </View>
      </Card>
      <View style={styles.between}>
        <Dots count={cards.length} current={i} label={fill(w.cardOf, { n: i + 1, total: cards.length })} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          {i > 0 ? <Small label={w.back} onPress={() => setI(i - 1)} /> : null}
          <Primary label={last ? w.toSetup : w.next} onPress={() => (last ? leave("done") : setI(i + 1))} />
        </View>
      </View>
    </View>
  );
}

function Dots({ count, current, label }: { count: number; current: number; label: string }) {
  const { color } = useTheme();
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {Array.from({ length: count }, (_, n) => (
        <View key={n} style={{ height: 6, width: n === current ? 24 : 6, borderRadius: 3, backgroundColor: n <= current ? color.accent : color.line, opacity: n < current ? 0.6 : 1 }} />
      ))}
    </View>
  );
}

// ---------- the setup steps ----------

function useProgress(data: OnboardingV1) {
  const { state } = useOnboarding();
  return setupProgress(data.audience, data.facts as SetupFacts, state ?? data.state ?? {});
}

type StepProps = {
  data: OnboardingV1;
  facts: SetupFacts;
  status: StepStatus;
  onAnswer: (mark: "done" | "skipped") => Promise<void>;
  onNext: () => void;
};

function Setup({ data, index, onIndex, onFinish }: { data: OnboardingV1; index: number; onIndex: (i: number) => void; onFinish: () => void }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const s = t.onboarding.setup;
  const { mark } = useOnboarding();
  const progress = useProgress(data);
  const step = progress.steps[index] ?? progress.steps[0]!;
  const total = progress.total;
  const facts = data.facts as SetupFacts;
  const [notice, setNotice] = useState<string | null>(null);

  function next() {
    setNotice(null);
    if (index >= total - 1) onFinish();
    else onIndex(index + 1);
  }
  /** Mark the step and move on; a mark that did not reach the server says so, but never holds the person here. */
  async function answer(markAs: "done" | "skipped") {
    if (!(markAs === "done" && facts[step.id])) {
      const saved = await mark(`step:${step.id}`, markAs);
      next();
      if (!saved) setNotice(s.error);
      return;
    }
    next();
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.between}>
        <Text style={[styles.eyebrow, { color: color.accentInk }]}>{fill(s.stepOf, { n: index + 1, total })}</Text>
        <Text accessibilityRole="link" onPress={() => router.replace(homeOf(data.audience))} style={[styles.quiet, { color: color.inkFaint }]}>{s.later}</Text>
      </View>

      <StepRail steps={progress.steps} current={index} onPick={onIndex} />

      <Card style={{ gap: 0, padding: 22 }}>
        <View style={styles.between}>
          <StatusPill status={step.status} />
          <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{s.optional}</Text>
        </View>
        <Text accessibilityRole="header" style={[styles.h1, { fontSize: 24, color: color.ink }]}>{s.steps[step.id].title}</Text>
        <StepBody step={step.id} data={data} facts={facts} status={step.status} onAnswer={answer} onNext={next} />
      </Card>

      {notice ? (
        <View style={{ borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: color.warnSoft }}>
          <Text accessibilityLiveRegion="polite" style={{ fontFamily: font.regular, fontSize: 13, color: color.warn }}>{notice}</Text>
        </View>
      ) : null}

      <View style={styles.between}>
        <View>{index > 0 ? <Small label={s.back} onPress={() => onIndex(index - 1)} /> : null}</View>
        {step.status !== "done" ? (
          <Text accessibilityRole="button" onPress={() => void answer("skipped")} style={[styles.quiet, { paddingVertical: 10, color: color.inkSoft }]}>{s.skip}</Text>
        ) : null}
      </View>
    </View>
  );
}

function StepRail({ steps, current, onPick }: { steps: { id: SetupStep; status: StepStatus }[]; current: number; onPick: (i: number) => void }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const s = t.onboarding.setup;
  const done = steps.filter((x) => x.status === "done").length;
  return (
    <View accessibilityLabel={s.stepsNav}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {steps.map((step, i) => (
          <Pressable
            key={step.id}
            accessibilityRole="button"
            accessibilityState={{ selected: i === current }}
            accessibilityLabel={`${i + 1}. ${s.steps[step.id].title} — ${s.status[step.status]}`}
            onPress={() => onPick(i)}
            style={{ flex: 1, paddingVertical: 8 }}
          >
            <View style={{
              height: 6, borderRadius: 3,
              backgroundColor: step.status === "done" ? color.accent : i === current ? color.accentSoft : step.status === "skipped" ? color.inkFaint : color.line,
              opacity: step.status === "skipped" && i !== current ? 0.4 : 1,
            }} />
          </Pressable>
        ))}
      </View>
      <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{fill(s.doneOf, { done, total: steps.length })}</Text>
    </View>
  );
}

function StatusPill({ status }: { status: StepStatus }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const done = status === "done";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, height: 28, borderRadius: 14, paddingHorizontal: 10, backgroundColor: done ? color.accentSoft : color.bg }}>
      {done ? <NavIcon d={CHECK} size={14} color={color.accentInk} /> : null}
      <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: done ? color.accentInk : status === "skipped" ? color.inkFaint : color.inkSoft }}>{t.onboarding.setup.status[status]}</Text>
    </View>
  );
}

function StepBody(props: StepProps & { step: SetupStep }) {
  switch (props.step) {
    case "photo": return <PhotoStep {...props} />;
    case "units": return <UnitsStep {...props} />;
    case "goal": return <GoalStep {...props} />;
    case "training": return <TrainingStep {...props} />;
    case "public_profile": return <PublicProfileStep {...props} />;
    case "invite": return <InviteStep {...props} />;
    case "program": return <ProgramStep {...props} />;
  }
}

function Why({ children }: { children: ReactNode }) {
  return <Text style={[styles.why, { color: useTheme().color.inkSoft }]}>{children}</Text>;
}

function Good({ children }: { children: ReactNode }) {
  return <Text style={{ marginTop: 12, fontFamily: font.semibold, fontSize: 13.5, color: useTheme().color.accentInk }}>{children}</Text>;
}

function Actions({ children }: { children: ReactNode }) {
  return <View style={{ marginTop: 22, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;
}

function PhotoStep({ data, facts, onAnswer }: StepProps) {
  const { t } = useI18n();
  const { color } = useTheme();
  const p = t.onboarding.setup.steps.photo;
  return (
    <>
      <Why>{data.audience === "coach" ? p.whyCoach : p.why}</Why>
      <View style={{ marginTop: 18, borderRadius: 16, padding: 16, backgroundColor: color.bg }}>
        <PhotoPicker kind="avatar" url={data.avatar_url} name={data.name} enabled={data.uploads} />
      </View>
      {facts.photo ? <Good>{p.has}</Good> : null}
      <Actions><Primary label={t.onboarding.setup.continue} disabled={!facts.photo} onPress={() => void onAnswer("done")} /></Actions>
    </>
  );
}

function isZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone.length > 0;
  } catch {
    return false;
  }
}

function UnitsStep({ data, onNext }: StepProps) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const { refresh } = useOnboarding();
  const s = t.onboarding.setup;
  const u = s.steps.units;
  const [weight, setWeight] = useState(data.weight_unit);
  const [length, setLength] = useState(data.length_unit);
  const [zone, setZone] = useState(data.timezone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zoneOk = isZone(zone.trim());
  const detected = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
      return null;
    }
  })();

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const r = await api.onboardingWrite("units", { weightUnit: weight, lengthUnit: length, timezone: zone.trim() });
      if (!r.ok) return setError(r.message === "Unknown time zone" ? u.badZone : s.error);
      await refresh();
      onNext();
    } catch {
      setError(t.common.actions.unreachable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Why>{u.why}</Why>
      <View style={{ marginTop: 18, flexDirection: "row", gap: 16 }}>
        <View style={{ flex: 1 }}>
          <Pills label={u.weight} value={weight} onChange={setWeight} options={[{ value: "kg", label: "kg" }, { value: "lb", label: "lb" }]} />
        </View>
        <View style={{ flex: 1 }}>
          <Pills label={u.length} value={length} onChange={setLength} options={[{ value: "cm", label: "cm" }, { value: "in", label: "in" }]} />
        </View>
      </View>
      <View style={{ marginTop: 14 }}>
        <Field plain label={u.timezone} value={zone} onChange={setZone} error={zoneOk ? null : u.badZone} />
        {detected && detected !== zone.trim() ? (
          <Text accessibilityRole="button" onPress={() => setZone(detected)} style={{ marginTop: 8, fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>
            {fill(u.detected, { zone: detected })}
          </Text>
        ) : null}
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Actions><Primary label={busy ? s.saving : s.save} busy={busy} disabled={!zoneOk} onPress={() => void save()} /></Actions>
    </>
  );
}

function GoalStep({ data, facts, onAnswer, onNext }: StepProps) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const { refresh } = useOnboarding();
  const s = t.onboarding.setup;
  const g = s.steps.goal;
  const labels = t.coachProfile.expertise.goals;
  const [picked, setPicked] = useState<ClientGoal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!picked) return void onAnswer("done");
    setError(null);
    setBusy(true);
    try {
      const r = await api.onboardingWrite("goal", { goal: picked });
      if (!r.ok) return setError(s.error);
      await refresh();
      onNext();
    } catch {
      setError(t.common.actions.unreachable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Why>{g.why}</Why>
      {data.goal ? <Good>{fill(g.current, { goal: data.goal })}</Good> : null}
      <Text style={{ marginTop: 16, fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{g.pick}</Text>
      <View accessibilityLabel={g.pick} style={{ marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {GOAL_CHOICES.map((code) => (
          <Chip key={code} on={picked === code} label={labels[code]} onPress={() => setPicked(picked === code ? null : code)} />
        ))}
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Actions>
        <Primary label={busy ? s.saving : picked ? s.save : s.continue} busy={busy} disabled={!picked && !facts.goal} onPress={() => void save()} />
      </Actions>
    </>
  );
}

function TrainingStep({ data, facts, onAnswer, onNext }: StepProps) {
  const { t } = useI18n();
  const { color } = useTheme();
  const { refresh } = useOnboarding();
  const s = t.onboarding.setup;
  const tr = s.steps.training;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (data.coached || facts.training) {
    return (
      <>
        <Why>{tr.why}</Why>
        <View style={{ marginTop: 16, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: color.accentSoft }}>
          <Text style={{ fontFamily: font.regular, fontSize: 14, color: color.accentInk }}>{data.coached ? tr.coached : tr.ready}</Text>
        </View>
        <Actions><Primary label={s.continue} onPress={() => void onAnswer("done")} /></Actions>
      </>
    );
  }

  async function solo() {
    setError(null);
    setBusy(true);
    try {
      const r = await api.onboardingWrite("solo");
      if (!r.ok) return setError(s.error);
      await refresh();
      onNext();
    } catch {
      setError(t.common.actions.unreachable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Why>{tr.why}</Why>
      <View style={{ marginTop: 18, gap: 10 }}>
        <Option title={tr.codeTitle}>
          <JoinCode onJoined={() => void refresh().then(onNext)} />
        </Option>
        <Option title={tr.findTitle} body={tr.findBody}>
          <Small label={tr.findCta} onPress={() => router.push("/coaches")} />
        </Option>
        <Option title={tr.soloTitle} body={tr.soloBody}>
          <Primary label={busy ? s.saving : tr.soloCta} busy={busy} onPress={() => void solo()} />
        </Option>
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </>
  );
}

function Option({ title, body, children }: { title: string; body?: string; children: ReactNode }) {
  const { color } = useTheme();
  return (
    <View style={{ borderRadius: 16, padding: 16, gap: 10, backgroundColor: color.bg }}>
      <View>
        <Text style={{ fontFamily: font.displayBold, fontSize: 15, color: color.ink }}>{title}</Text>
        {body ? <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: color.inkSoft }}>{body}</Text> : null}
      </View>
      <View style={{ alignSelf: "stretch" }}>{children}</View>
    </View>
  );
}

function PublicProfileStep({ data, facts, onAnswer }: StepProps) {
  const { t } = useI18n();
  const { color } = useTheme();
  const s = t.onboarding.setup;
  const pp = s.steps.public_profile;
  const status = (data.coach_profile_status ?? "none") as keyof typeof pp;
  const line = typeof pp[status] === "string" ? pp[status] : pp.none;
  return (
    <>
      <Why>{pp.why}</Why>
      <Text style={{ marginTop: 16, fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{line}</Text>
      <Actions>
        <Primary label={pp.cta} onPress={() => router.push("/coach/profile")} />
        {facts.public_profile ? <Small label={s.continue} onPress={() => void onAnswer("done")} /> : null}
      </Actions>
    </>
  );
}

function InviteStep({ data, onAnswer }: StepProps) {
  const { t } = useI18n();
  const s = t.onboarding.setup;
  const inv = s.steps.invite;
  return (
    <>
      <Why>{inv.why}</Why>
      {data.has_clients ? <Good>{inv.has}</Good> : null}
      <View style={{ marginTop: 18 }}><InviteCode /></View>
      <Actions><Primary label={s.continue} onPress={() => void onAnswer("done")} /></Actions>
    </>
  );
}

function ProgramStep({ data, facts, onAnswer }: StepProps) {
  const { t } = useI18n();
  const { color } = useTheme();
  const s = t.onboarding.setup;
  const pr = s.steps.program;
  return (
    <>
      <Why>{pr.why}</Why>
      {facts.program ? (
        <Good>{pr.has}</Good>
      ) : !data.has_clients ? (
        <View style={{ marginTop: 16, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: color.bg }}>
          <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{pr.noClients}</Text>
        </View>
      ) : null}
      <Actions>
        {facts.program
          ? <Primary label={s.continue} onPress={() => void onAnswer("done")} />
          : <Primary label={pr.cta} onPress={() => router.push("/coach/programs")} />}
      </Actions>
    </>
  );
}

// ---------- the summary ----------

function Finish({ data, onOpen }: { data: OnboardingV1; onOpen: (i: number) => void }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const s = t.onboarding.setup;
  const { mark } = useOnboarding();
  const progress = useProgress(data);
  const [busy, setBusy] = useState(false);
  const client = data.audience === "client";
  const allDone = progress.done === progress.total;

  return (
    <Card style={{ gap: 0, padding: 22 }}>
      <View style={[styles.iconBox, { backgroundColor: color.accentSoft }]}>
        <NavIcon d={CHECK} size={28} color={color.accentInk} />
      </View>
      <Text accessibilityRole="header" style={[styles.h1, { color: color.ink }]}>{s.finishTitle}</Text>
      <Text style={[styles.why, { color: color.inkSoft }]}>{allDone ? s.finishBody : client ? s.finishPartial : s.finishPartialCoach}</Text>
      <View style={{ marginTop: 18, borderRadius: 16, overflow: "hidden", backgroundColor: color.bg }}>
        {progress.steps.map((step, i) => (
          <Pressable
            key={step.id}
            accessibilityRole="button"
            onPress={() => onOpen(i)}
            style={({ pressed }) => [styles.between, { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: color.line, opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{s.steps[step.id].title}</Text>
            <StatusPill status={step.status} />
          </Pressable>
        ))}
      </View>
      <Actions>
        <Primary
          label={client ? s.finishClient : s.finishCoach}
          busy={busy}
          onPress={async () => {
            setBusy(true);
            // finished for good only when nothing is left; otherwise the card on Today stays the way back
            if (allDone) await mark("setup", "done");
            setBusy(false);
            router.replace(homeOf(data.audience));
          }}
        />
      </Actions>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48, gap: 16 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  eyebrow: { fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" },
  quiet: { fontFamily: font.semibold, fontSize: 13 },
  iconBox: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  h1: { marginTop: 18, fontFamily: font.displayExtrabold, fontSize: 26, lineHeight: 31, letterSpacing: -0.4 },
  why: { marginTop: 10, fontFamily: font.regular, fontSize: 14.5, lineHeight: 21 },
});
