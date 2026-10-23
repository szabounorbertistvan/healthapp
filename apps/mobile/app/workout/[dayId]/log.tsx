import type { LogSetV1, WorkoutDayV1, WorkoutExerciseV1 } from "@healthapp/api/v1";
import {
  displayToKg, kgToDisplay, MAX_SET_REPS, MAX_SET_SECONDS, MAX_SET_WEIGHT_KG, restAfterLoggedSet, validateSetEdit,
} from "@healthapp/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { RestBar } from "@/components/rest-bar";
import { Button, Card, Screen, T } from "@/components/ui";
import { BackHeader, prescription, Previous, setText } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n, type Dictionary } from "@/lib/i18n";
import { loggedCount, nextSetIndex, parseDecimal, prefill, setsByExercise, type DisplaySet } from "@/lib/logger-model";
import { useOfflineQuery } from "@/lib/offline-query";
import { queuedForDay } from "@/lib/outbox-core";
import { useOutbox } from "@/lib/outbox";
import { useRest } from "@/lib/rest";
import { fontSize, minTouchTarget, radius, space, useTheme } from "@/lib/theme";

// The set logger — the web's /workout/[dayId]/log on the phone, built for no
// signal: the day comes from the phone's copy when the server cannot be
// reached, and every set is saved on the phone first and sent by the outbox
// (lib/outbox.tsx) through the web's own logSet(). The rest timer starts the
// moment a set is saved, by the same restAfterLoggedSet() rule as the web.
export default function SetLoggerScreen() {
  const { dayId } = useLocalSearchParams<{ dayId: string }>();
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const { session } = useAuth();
  const outbox = useOutbox();
  const rest = useRest();
  const queryClient = useQueryClient();
  const query = useOfflineQuery(`day:${dayId}`, ["workout", dayId], () => api.workoutDay(dayId));
  const day = query.data?.data;
  const userId = session?.user.id ?? "";

  const [pr, setPr] = useState<string | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finished, setFinished] = useState(false);

  // The PR moment arrives with the server's answer, not before: it is the server's verdict.
  useEffect(
    () =>
      outbox.onSynced((synced) => {
        const hit = synced.find((s) => s.isPr && s.item.input.dayId === dayId);
        if (hit) setPr(hit.item.input.exerciseName);
      }),
    [outbox, dayId],
  );

  if (!day) {
    return (
      <Screen>
        <SafeAreaView style={styles.body}>
          <BackHeader label={t.clientApp.workoutDay.backToTraining} />
          {query.isError ? <T kind="soft">{t.mobile.workout.needsDayFirst}</T> : <ActivityIndicator color={color.accent} />}
        </SafeAreaView>
      </Screen>
    );
  }

  const mine = queuedForDay(outbox.items, userId, day.day_id);
  const sets = setsByExercise(day, mine);
  const waiting = mine.filter((q) => !q.error).length;
  const refused = mine.filter((q) => q.error);
  const done = Object.values(loggedCount(sets)).reduce((a, b) => a + b, 0);
  const total = day.exercises.reduce((a, e) => a + e.sets, 0);

  async function finish() {
    if (!day) return;
    setFinishing(true);
    setFinishError(null);
    // Finishing closes the session, so every set must be on the server first.
    // Twice: a flush already running when the last set was logged did not see it.
    await outbox.flush();
    const flushed = await outbox.flush();
    if (flushed?.stoppedBy) {
      setFinishError(t.clientWidgets.setLogger.finishNeedsSync);
      setFinishing(false);
      return;
    }
    try {
      const result = await api.finishWorkout(day.day_id);
      if (!result.ok) {
        setFinishError(result.message ?? t.clientWidgets.setLogger.couldNotFinish);
        return;
      }
      rest.clear();
      setFinished(true);
      void queryClient.invalidateQueries({ queryKey: ["workout", day.day_id] });
      void queryClient.invalidateQueries({ queryKey: ["workouts"] });
      void queryClient.invalidateQueries({ queryKey: ["today"] });
    } catch (error) {
      setFinishError(
        error instanceof ApiFailure && error.kind === "offline"
          ? t.clientWidgets.setLogger.finishNeedsSync
          : t.clientWidgets.setLogger.couldNotFinish,
      );
    } finally {
      setFinishing(false);
    }
  }

  if (finished) {
    return (
      <Screen>
        <SafeAreaView style={styles.body}>
          <T kind="title">{t.mobile.workout.finished}</T>
          <T kind="soft">{fill(t.clientWidgets.setLogger.setsProgress, { done, total })}</T>
          <Button label={t.mobile.workout.backToTraining} onPress={() => router.replace("/workout")} />
        </SafeAreaView>
      </Screen>
    );
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.header}>
            <BackHeader label={day.day_name} />
            <T kind="faint">{`${day.program_name.toUpperCase()} · ${day.intensity_mode.toUpperCase()}`}</T>
            <T kind="heading">{t.clientApp.workoutDay.logToday}</T>
            <T kind="faint">{fill(t.clientWidgets.setLogger.setsProgress, { done, total })}</T>
            <RestBar />
          </View>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {query.data?.fromPhone ? <T kind="faint">{t.mobile.workout.fromPhone}</T> : null}
            {pr ? (
              <Pressable accessibilityRole="button" onPress={() => setPr(null)}>
                <Card style={{ borderColor: color.accent }}>
                  <T kind="heading">{fill(t.mobile.workout.newPr, { name: pr })}</T>
                  <T kind="soft">{t.clientWidgets.setLogger.personalRecordDetail}</T>
                </Card>
              </Pressable>
            ) : null}
            {waiting > 0 ? (
              <T kind="soft">
                {waiting === 1 ? t.clientWidgets.setLogger.pendingSyncOne : fill(t.clientWidgets.setLogger.pendingSync, { count: waiting })}
              </T>
            ) : null}
            {refused.length > 0 ? (
              <Card style={{ borderColor: color.risk }}>
                {refused.map((q) => (
                  <T key={q.id} style={{ color: color.risk }}>
                    {fill(t.clientWidgets.setLogger.syncFailed, {
                      set: `${q.input.exerciseName} ${fill(t.clientWidgets.setLogger.setN, { n: q.input.setIndex })}`,
                      message: q.error ?? "",
                    })}
                  </T>
                ))}
                <Button kind="quiet" label={t.clientWidgets.setLogger.dismiss} onPress={() => void outbox.dismissRefused()} />
              </Card>
            ) : null}

            {[...day.exercises]
              .sort((a, b) => a.position - b.position)
              .map((e) => (
                <ExerciseCard
                  key={e.id}
                  e={e}
                  day={day}
                  sets={sets[e.id] ?? []}
                  onLog={async (input) => {
                    await outbox.log(input);
                    // Saved (on the phone at least): now, and only now, the rest starts.
                    const counts = loggedCount(sets);
                    counts[e.id] = (counts[e.id] ?? 0) + 1;
                    const plan = restAfterLoggedSet({
                      saved: true,
                      day: {
                        exercises: day.exercises.map((x) => ({ id: x.id, exercise: x.name, sets: x.sets, position: x.position, circuit: x.circuit })),
                        completed: day.completed,
                      },
                      loggedCount: counts,
                      justLogged: {
                        programExerciseId: e.id,
                        exerciseId: e.exercise_id,
                        setIndex: input.setIndex,
                        prescribedSeconds: e.rest_seconds,
                      },
                      prefs: { default_seconds: day.rest.default_seconds, notify: true, alert: day.rest.alert, exercises: day.rest.exercises },
                    });
                    if (plan) rest.start(plan, { dayId: day.day_id, exerciseName: e.name, setIndex: input.setIndex }, day.rest.alert);
                  }}
                />
              ))}

            {finishError ? <T style={{ color: color.risk }}>{finishError}</T> : null}
            <Button label={t.clientWidgets.setLogger.finishWorkout} busy={finishing} onPress={() => void finish()} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Screen>
  );
}

function ExerciseCard({
  e, day, sets, onLog,
}: {
  e: WorkoutExerciseV1;
  day: WorkoutDayV1;
  sets: DisplaySet[];
  onLog: (input: LogSetV1) => Promise<void>;
}) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const unit = day.weight_unit;
  const timed = e.measure === "time";
  const setIndex = nextSetIndex(sets);
  const initial = prefill(e, sets, day.previous, unit);
  const [weight, setWeight] = useState(initial.weight);
  const [reps, setReps] = useState(initial.reps);
  const [rpe, setRpe] = useState(8);
  const [rir, setRir] = useState(e.target_rpe != null && day.intensity_mode === "rir" ? String(e.target_rpe) : "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A new set number: the boxes move on to what that set should be.
  useEffect(() => {
    const next = prefill(e, sets, day.previous, unit);
    setWeight(next.weight);
    setReps(next.reps);
    setNote("");
    // Only on a new set number — not on every re-read of the day.
  }, [setIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  async function log() {
    setError(null);
    const message = checkSet();
    if (message) return setError(message);
    if (!e.exercise_id) return setError(t.clientWidgets.setLogger.errMissingExercise);
    const amount = Number(reps.trim());
    const input: LogSetV1 = {
      dayId: day.day_id,
      dayName: day.day_name,
      exerciseName: e.name,
      exerciseId: e.exercise_id,
      programExerciseId: e.id,
      setIndex,
      weightKg: weightKg(),
      reps: timed ? 0 : amount,
      durationSeconds: timed ? amount : null,
      rpe,
      rir: day.intensity_mode === "rir" && rir.trim() ? parseDecimal(rir) : null,
      notes: note.trim() || null,
      loggedAt: new Date().toISOString(),
    };
    setBusy(true);
    try {
      await onLog(input);
    } catch {
      setError(t.clientWidgets.setLogger.couldNotLogSet);
    } finally {
      setBusy(false);
    }
  }

  function weightKg(): number {
    const shown = weight.trim() === "" ? 0 : parseDecimal(weight);
    return Number.isNaN(shown) ? Number.NaN : displayToKg(shown, unit);
  }

  /** The web logger's checks, in the person's own unit, before anything is saved. */
  function checkSet(): string | null {
    const amount = Number(reps.trim());
    const rirValue = day.intensity_mode === "rir" && rir.trim() ? parseDecimal(rir) : null;
    const invalid = validateSetEdit({
      weight_kg: weightKg(),
      reps: timed ? 0 : amount,
      duration_seconds: timed ? amount : null,
      rpe,
      rir: rirValue,
      notes: note.trim() || null,
    });
    if (!invalid) return null;
    const m = t.clientWidgets.setLogger;
    if (invalid === "weight") return fill(m.errWeight, { max: kgToDisplay(MAX_SET_WEIGHT_KG, unit), unit });
    if (invalid === "reps") return fill(m.errReps, { max: MAX_SET_REPS });
    if (invalid === "duration") return fill(m.errDuration, { max: MAX_SET_SECONDS });
    return invalid === "rpe" ? m.errRpe : m.errRir;
  }

  const field = [styles.field, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }];
  const repsLabel = timed ? t.clientWidgets.setLogger.seconds : t.clientWidgets.setLogger.reps;

  return (
    <Card>
      <View style={styles.titleRow}>
        <T kind="heading" style={{ flex: 1 }}>{e.name}</T>
        <T kind="faint">{`${Math.min(sets.filter((s) => s.state !== "refused").length, e.sets)}/${e.sets}`}</T>
      </View>
      <T kind="soft">{prescription(e, day.intensity_mode, t)}</T>
      {e.notes ? <T kind="faint">{`${t.clientWidgets.setLogger.coachNote}: ${e.notes}`}</T> : null}
      <Previous e={e} day={day} t={t} />

      {sets.length > 0 ? (
        <View style={{ gap: 4 }}>
          <T kind="faint">{t.mobile.workout.today}</T>
          {sets.map((s) => (
            <SetRow key={`${s.set_index}:${s.at}`} s={s} unit={unit} t={t} />
          ))}
        </View>
      ) : null}

      <View style={styles.inputs}>
        <Labeled label={unit}>
          <TextInput
            accessibilityLabel={t.clientWidgets.setLogger.kg}
            value={weight}
            onChangeText={setWeight}
            keyboardType="decimal-pad"
            style={field}
          />
        </Labeled>
        <Labeled label={repsLabel}>
          <TextInput accessibilityLabel={repsLabel} value={reps} onChangeText={setReps} keyboardType="number-pad" style={field} />
        </Labeled>
        {day.intensity_mode === "rir" ? (
          <Labeled label={t.clientWidgets.setLogger.rir}>
            <TextInput accessibilityLabel={t.clientWidgets.setLogger.rir} value={rir} onChangeText={setRir} keyboardType="number-pad" style={field} />
          </Labeled>
        ) : null}
      </View>

      <View style={styles.stepperRow}>
        <T kind="faint" style={{ flex: 1 }}>{t.mobile.workout.intensity}</T>
        <Stepper value={rpe} onChange={setRpe} label={t.clientWidgets.setLogger.intensity} />
      </View>
      <TextInput
        accessibilityLabel={t.clientWidgets.setLogger.note}
        placeholder={t.mobile.workout.notePlaceholder}
        placeholderTextColor={color.inkFaint}
        value={note}
        onChangeText={setNote}
        maxLength={500}
        style={[field, { textAlign: "left" }]}
      />
      {error ? <T style={{ color: color.risk }}>{error}</T> : null}
      <Button label={`${t.clientWidgets.setLogger.logSet} · ${fill(t.clientWidgets.setLogger.setN, { n: setIndex })}`} busy={busy} onPress={() => void log()} />
    </Card>
  );
}

function SetRow({ s, unit, t }: { s: DisplaySet; unit: WorkoutDayV1["weight_unit"]; t: Dictionary }) {
  const { color } = useTheme();
  const { fill } = useI18n();
  const mark = s.state === "synced" ? "✓" : s.state === "pending" ? "◷" : "!";
  const tone = s.state === "refused" ? color.risk : s.state === "pending" ? color.inkFaint : color.ink;
  const extras = [
    s.rir != null ? `${t.clientWidgets.setLogger.rir} ${s.rir}` : null,
    s.rpe != null ? `${s.rpe}/10` : null,
    s.is_pr ? t.clientWidgets.setLogger.pr : null,
  ].filter(Boolean);
  return (
    <View style={styles.setRow}>
      <T style={{ color: tone, width: 22 }}>{mark}</T>
      <T style={{ color: tone, flex: 1 }}>
        {`${s.set_index}. ${setText(s, unit, t)}${extras.length ? ` · ${extras.join(" · ")}` : ""}`}
      </T>
      {s.state === "pending" ? <T kind="faint">{t.mobile.workout.waiting}</T> : null}
      {s.state === "refused" && s.error ? <T style={{ color: color.risk }}>{fill(t.mobile.workout.refused, { message: s.error })}</T> : null}
    </View>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <T kind="faint">{label}</T>
      {children}
    </View>
  );
}

function Stepper({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const { color } = useTheme();
  const step = (d: number) => onChange(Math.max(1, Math.min(10, value + d)));
  const button = (text: string, d: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${text}`}
      onPress={() => step(d)}
      style={[styles.stepButton, { borderColor: color.line }]}
    >
      <T style={{ fontWeight: "800", fontSize: fontSize.lg }}>{text}</T>
    </Pressable>
  );
  return (
    <View style={styles.stepper} accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min: 1, max: 10, now: value }}>
      {button("−", -1)}
      <T kind="heading" style={{ minWidth: 48, textAlign: "center" }}>{`${value}/10`}</T>
      {button("+", 1)}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: 2, paddingBottom: space.sm },
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  inputs: { flexDirection: "row", gap: space.sm, marginTop: space.sm },
  field: {
    minHeight: minTouchTarget + 4,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    fontSize: fontSize.lg,
    textAlign: "center",
  },
  setRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  stepper: { flexDirection: "row", alignItems: "center", gap: space.sm },
  stepButton: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    borderWidth: 1,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
});
