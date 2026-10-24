import type { LogSetV1, WorkoutDayV1, WorkoutExerciseV1 } from "@healthapp/api/v1";
import {
  circuitSegments, displayToKg, kgToDisplay, MAX_SET_REPS, MAX_SET_SECONDS, MAX_SET_WEIGHT_KG, resolveRestSeconds,
  restAfterLoggedSet, validateSetEdit,
} from "@healthapp/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EditSet } from "@/components/edit-set";
import { RestBar } from "@/components/rest-bar";
import { Card, NavIcon, Slider, T } from "@/components/ui";
import { setText } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { timeAgo } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { loggedCount, nextSetIndex, parseDecimal, prefill, setsByExercise, type DisplaySet } from "@/lib/logger-model";
import { useOfflineQuery } from "@/lib/offline-query";
import { queuedForDay } from "@/lib/outbox-core";
import { useOutbox } from "@/lib/outbox";
import { useRest } from "@/lib/rest";
import { alpha, font, useTheme } from "@/lib/theme";

// The set logger — the web's /workout/[dayId]/log on the phone (set-logger.tsx),
// built for no signal: the day comes from the phone's copy when the server
// cannot be reached, and every set is saved on the phone first and sent by the
// outbox (lib/outbox.tsx) through the web's own logSet(). The rest timer starts
// the moment a set is saved, by the same restAfterLoggedSet() rule as the web.

const LINK_ICON = "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1";
const CLOCK = "M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z";

function Back({ label }: { label: string }) {
  const { color } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/workout"))}
      style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 4 }}
    >
      <NavIcon d="m15 6-6 6 6 6" size={14} color={color.inkFaint} />
      <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkFaint }}>{label}</Text>
    </Pressable>
  );
}

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
  const m = t.clientWidgets.setLogger;

  const [pr, setPr] = useState<string | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finished, setFinished] = useState(false);

  // The PR moment arrives with the server's answer, not before: it is the server's verdict.
  useEffect(
    () =>
      outbox.onSynced((synced) => {
        for (const { item, isPr } of synced) {
          if (isPr && item.kind === "set" && item.input.dayId === dayId) setPr(item.input.exerciseName);
        }
      }),
    [outbox, dayId],
  );

  if (!day) {
    return (
      <SafeAreaView style={styles.body}>
        <Back label={t.clientApp.workoutDay.backToTraining} />
        {query.isError ? <T kind="soft">{t.mobile.workout.needsDayFirst}</T> : <ActivityIndicator color={color.accent} />}
      </SafeAreaView>
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
      setFinishError(m.finishNeedsSync);
      setFinishing(false);
      return;
    }
    try {
      const result = await api.finishWorkout(day.day_id);
      if (!result.ok) {
        setFinishError(result.message ?? m.couldNotFinish);
        return;
      }
      rest.clear();
      setFinished(true);
      void queryClient.invalidateQueries({ queryKey: ["workout", day.day_id] });
      void queryClient.invalidateQueries({ queryKey: ["workouts"] });
      void queryClient.invalidateQueries({ queryKey: ["today"] });
    } catch (error) {
      setFinishError(error instanceof ApiFailure && error.kind === "offline" ? m.finishNeedsSync : m.couldNotFinish);
    } finally {
      setFinishing(false);
    }
  }

  if (finished) {
    return (
      <SafeAreaView style={styles.body}>
        <Text style={styles.title(color.ink)}>{t.mobile.workout.finished}</Text>
        <T kind="soft">{fill(m.setsProgress, { done, total })}</T>
        <AccentButton label={t.mobile.workout.backToTraining} onPress={() => router.replace("/workout")} />
      </SafeAreaView>
    );
  }

  const block = (e: WorkoutExerciseV1, inCircuit: boolean) => (
    <ExerciseBlock
      key={e.id}
      e={e}
      day={day}
      inCircuit={inCircuit}
      sets={sets[e.id] ?? []}
      onLog={async (input, restTyped) => {
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
            restSecondsForThisSet: restTyped,
          },
          prefs: { default_seconds: day.rest.default_seconds, notify: true, alert: day.rest.alert, exercises: day.rest.exercises },
        });
        if (plan) rest.start(plan, { dayId: day.day_id, exerciseName: e.name, setIndex: input.setIndex }, day.rest.alert);
      }}
    />
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Back label={day.day_name} />
          <View style={{ marginTop: -4 }}>
            <Text numberOfLines={1} style={styles.kicker(color.inkFaint)}>{`${day.program_name} · ${day.intensity_mode.toUpperCase()}`}</Text>
            <Text style={[styles.title(color.ink), { marginTop: 4 }]}>{t.clientApp.workoutDay.logToday}</Text>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1, height: 10, borderRadius: 6, overflow: "hidden", backgroundColor: color.surface }}>
              <View style={{ height: "100%", borderRadius: 6, backgroundColor: color.accent, width: `${total ? Math.min(100, (done / total) * 100) : 0}%` }} />
            </View>
            <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{fill(m.setsProgress, { done, total })}</Text>
          </View>
          <RestBar />

          {query.data?.fromPhone ? <T kind="faint">{t.mobile.workout.fromPhone}</T> : null}
          {pr ? (
            <Pressable accessibilityRole="button" onPress={() => setPr(null)} style={{ borderRadius: 24, backgroundColor: color.accentSoft, paddingHorizontal: 20, paddingVertical: 18 }}>
              <Text style={{ fontFamily: font.displayBold, fontSize: 16, color: color.accentInk }}>{fill(m.personalRecord, { name: pr })}</Text>
              <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 12.5, color: color.accentInk }}>{m.personalRecordDetail}</Text>
            </Pressable>
          ) : null}
          {waiting > 0 ? <T kind="soft">{waiting === 1 ? m.pendingSyncOne : fill(m.pendingSync, { count: waiting })}</T> : null}
          {refused.length > 0 ? (
            <View style={{ borderRadius: 20, backgroundColor: color.riskSoft, padding: 16, gap: 8 }}>
              {refused.map((q) => (
                <Text key={q.id} style={{ fontFamily: font.semibold, fontSize: 13, color: color.risk }}>
                  {fill(m.syncFailed, { set: `${q.input.exerciseName} ${fill(m.setN, { n: q.input.setIndex })}`, message: q.error ?? "" })}
                </Text>
              ))}
              <Pressable accessibilityRole="button" onPress={() => void outbox.dismissRefused()} style={{ alignSelf: "flex-start" }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{m.dismiss}</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={{ gap: 14 }}>
            {circuitSegments(day.exercises).map((seg, si) =>
              seg.circuit !== null ? (
                <View key={seg.circuit} style={[styles.circuit, { borderLeftColor: color.accent, backgroundColor: alpha(color.accentSoft, 0.55) }]}>
                  {seg.label ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingTop: 4 }}>
                      <NavIcon d={LINK_ICON} size={13} color={color.accentInk} />
                      <Text style={{ flexShrink: 1, fontFamily: font.bold, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: color.accentInk }}>
                        {`${fill(t.coachWidgets.programBuilder.circuitName, { label: seg.label })} · ${m.circuitHint}`}
                      </Text>
                    </View>
                  ) : null}
                  {seg.exercises.map((e) => block(e, true))}
                </View>
              ) : (
                <View key={`solo-${si}`} style={{ gap: 14 }}>{seg.exercises.map((e) => block(e, false))}</View>
              ),
            )}
          </View>

          {finishError ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.risk }}>{finishError}</Text> : null}
          <AccentButton label={m.finishWorkout} busy={finishing} disabled={done === 0} height={48} onPress={() => void finish()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** The web's solid gold action (bg-accent, Exo 2 bold); 40 % when it cannot be pressed yet. */
function AccentButton({ label, onPress, busy = false, disabled = false, height = 48 }: {
  label: string; onPress: () => void; busy?: boolean; disabled?: boolean; height?: number;
}) {
  const { color } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        { height, borderRadius: 16, paddingHorizontal: 20, alignItems: "center", justifyContent: "center", backgroundColor: color.accent },
        { opacity: disabled || busy ? 0.4 : pressed ? 0.9 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color={color.accentFg} /> : <Text style={{ fontFamily: font.displayBold, fontSize: 15, color: color.accentFg }}>{label}</Text>}
    </Pressable>
  );
}

function ExerciseBlock({
  e, day, sets, inCircuit, onLog,
}: {
  e: WorkoutExerciseV1;
  day: WorkoutDayV1;
  sets: DisplaySet[];
  inCircuit: boolean;
  onLog: (input: LogSetV1, restSeconds: number | null) => Promise<void>;
}) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const m = t.clientWidgets.setLogger;
  const unit = day.weight_unit;
  const timed = e.measure === "time";
  const asRir = day.intensity_mode === "rir";
  const setIndex = nextSetIndex(sets);
  const logged = sets.filter((s) => s.state !== "refused").length;
  const complete = logged >= e.sets;
  const initial = prefill(e, sets, day.previous, unit);
  const [weight, setWeight] = useState(initial.weight);
  const [reps, setReps] = useState(initial.reps);
  // Intensity 1..10, pre-set from the target the way the web does: RIR 2 ≈ 8/10.
  const [rpe, setRpe] = useState(e.target_rpe == null ? 7 : Math.round(Math.min(10, Math.max(1, asRir ? 10 - e.target_rpe : e.target_rpe))));
  const [rir, setRir] = useState(e.target_rpe != null && asRir ? String(e.target_rpe) : "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  // The REST box: the pause after the set being logged, pre-filled as the timer would resolve it.
  const effectiveRest = resolveRestSeconds({
    exerciseId: e.exercise_id,
    prescribedSeconds: e.rest_seconds,
    prefs: { default_seconds: day.rest.default_seconds, notify: true, alert: day.rest.alert, exercises: day.rest.exercises },
  });
  const [restInput, setRestInput] = useState(String(effectiveRest));

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
    if (!e.exercise_id) return setError(m.errMissingExercise);
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
      rir: asRir && rir.trim() ? parseDecimal(rir) : null,
      notes: note.trim() || null,
      loggedAt: new Date().toISOString(),
    };
    const restTyped = /^\d+$/.test(restInput.trim()) ? Number(restInput.trim()) : null;
    setBusy(true);
    try {
      await onLog(input, restTyped);
    } catch {
      setError(m.couldNotLogSet);
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
    const rirValue = asRir && rir.trim() ? parseDecimal(rir) : null;
    const invalid = validateSetEdit({
      weight_kg: weightKg(),
      reps: timed ? 0 : amount,
      duration_seconds: timed ? amount : null,
      rpe,
      rir: rirValue,
      notes: note.trim() || null,
    });
    if (!invalid) return null;
    if (invalid === "weight") return fill(m.errWeight, { max: kgToDisplay(MAX_SET_WEIGHT_KG, unit), unit });
    if (invalid === "reps") return fill(m.errReps, { max: MAX_SET_REPS });
    if (invalid === "duration") return fill(m.errDuration, { max: MAX_SET_SECONDS });
    return invalid === "rpe" ? m.errRpe : m.errRir;
  }

  const last = e.exercise_id ? day.previous[e.exercise_id] : undefined;
  const target = `${e.sets}×${e.reps}${timed ? " s" : ""}${e.target_rpe != null && day.intensity_mode !== "simple" ? ` · ${asRir ? m.rir : m.rpe} ${e.target_rpe}` : ""}${e.weight_kg ? ` · ${kgToDisplay(e.weight_kg, unit)} ${unit}` : ""} · ${m.rest} ${e.rest_seconds ? `${e.rest_seconds}s` : "—"}`;

  return (
    <Card style={{ gap: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{e.name}</Text>
          <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{target}</Text>
        </View>
        <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, backgroundColor: complete ? color.accentSoft : color.bg }}>
          <Text style={{ fontFamily: font.bold, fontSize: 11, color: complete ? color.accentInk : color.inkFaint }}>{`${Math.min(logged, e.sets)}/${e.sets}`}</Text>
        </View>
      </View>

      {e.notes ? (
        <View style={[styles.note, { borderLeftColor: color.accent, backgroundColor: alpha(color.accentSoft, 0.4) }]}>
          <Text style={styles.label(color.accentInk)}>{m.coachNote}</Text>
          <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12.5, color: color.ink }}>{e.notes}</Text>
        </View>
      ) : null}

      {last ? (
        <View style={[styles.note, { borderLeftColor: color.line, backgroundColor: alpha(color.bg, 0.6) }]}>
          <Text style={styles.label(color.inkFaint)}>{`${m.previous} · ${timeAgo(last.at, locale)}`}</Text>
          <View style={{ marginTop: 4, gap: 2 }}>
            {last.sets.map((s) => (
              <View key={s.set_index} style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                <Text style={{ width: 12, textAlign: "right", fontFamily: font.regular, fontSize: 10, color: color.inkFaint }}>{s.set_index}</Text>
                <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: color.ink }}>{setText(s, unit, t)}</Text>
                {s.rir !== null ? (
                  <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{`· ${m.rir} ${s.rir}`}</Text>
                ) : s.rpe !== null ? (
                  <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{`· ${s.rpe}/10`}</Text>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      ) : (
        <Text style={{ marginTop: 10, fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{m.previousNone}</Text>
      )}

      {sets.length > 0 ? (
        <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {sets.map((s) => {
            const editable = s.state === "synced" && Boolean(s.id);
            const refused = s.state === "refused";
            return (
              <Pressable
                key={`${s.set_index}:${s.at}`}
                accessibilityRole={editable ? "button" : undefined}
                accessibilityLabel={`${m.editSet}: ${setText(s, unit, t)}`}
                disabled={!editable}
                onPress={() => setEditing(editing === s.id ? null : s.id ?? null)}
                style={[
                  styles.chip,
                  { backgroundColor: refused ? color.riskSoft : s.is_pr ? color.accent : color.bg },
                  editing && editing === s.id ? { borderWidth: 2, borderColor: color.accentInk } : null,
                ]}
              >
                <Text style={{ fontFamily: s.is_pr ? font.semibold : font.regular, fontSize: 12, color: refused ? color.risk : s.is_pr ? color.accentFg : color.inkSoft }}>
                  {`${setText(s, unit, t)}${s.rir != null ? ` · ${m.rir} ${s.rir}` : ""}${s.rpe != null ? ` · ${s.rpe}/10` : ""}${s.is_pr ? ` · ${m.pr}` : ""}${s.notes ? " · ✎" : ""}`}
                </Text>
                {s.state === "pending" ? <NavIcon d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0" size={12} color={color.inkFaint} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {editing ? (() => {
        const target = sets.find((x) => x.id === editing);
        return target ? <EditSet set={target} exercise={e} day={day} onClose={() => setEditing(null)} /> : null;
      })() : null}

      <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: 8 }}>
        <Field label={unit} value={weight} onChange={setWeight} keyboard="decimal-pad" />
        <Field label={timed ? m.seconds : m.reps} value={reps} onChange={setReps} keyboard="number-pad" />
        {asRir ? <Field label={m.rir} value={rir} onChange={setRir} keyboard="decimal-pad" /> : null}
        <Field
          label={t.clientWidgets.restTimer.restSeconds}
          icon={CLOCK}
          accent
          highlighted={restInput !== String(effectiveRest)}
          value={restInput}
          onChange={(v) => setRestInput(v.replace(/[^\d]/g, ""))}
          keyboard="number-pad"
          a11y={t.clientWidgets.restTimer.restForThisSet}
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void log()}
          style={({ pressed }) => [styles.logSet, { backgroundColor: color.accent, opacity: busy ? 0.4 : pressed ? 0.9 : 1 }]}
        >
          {busy ? <ActivityIndicator color={color.accentFg} /> : <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.accentFg }}>{m.logSet}</Text>}
        </Pressable>
      </View>
      {error ? <Text accessibilityRole="alert" style={{ marginTop: 8, fontFamily: font.semibold, fontSize: 13, color: color.risk }}>{error}</Text> : null}

      <View style={{ marginTop: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
          <Text style={styles.label(color.inkFaint)}>{m.intensity}</Text>
          <Text style={{ fontFamily: font.bold, fontSize: 12, color: color.ink }}>
            {rpe}
            <Text style={{ fontFamily: font.regular, color: color.inkFaint }}>/10</Text>
          </Text>
        </View>
        <Slider value={rpe} onChange={setRpe} label={m.intensity} />
        <Text style={{ fontFamily: font.regular, fontSize: 10, color: color.inkFaint }}>{m.intensityScale}</Text>
      </View>

      <View style={{ marginTop: 8, gap: 4 }}>
        <Text style={styles.label(color.inkFaint)}>{m.note}</Text>
        <TextInput
          accessibilityLabel={m.note}
          placeholder={m.notePlaceholder}
          placeholderTextColor={color.inkFaint}
          value={note}
          onChangeText={setNote}
          maxLength={500}
          style={[styles.input, { width: "100%", textAlign: "left", paddingHorizontal: 12, color: color.ink, backgroundColor: color.surface, borderColor: color.line }]}
        />
      </View>
    </Card>
  );
}

/** A labelled box (the web's Field): 10 px uppercase label over a 44 × 68 input on the surface. */
function Field({ label, value, onChange, keyboard, icon, accent = false, highlighted = false, a11y }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  keyboard: "decimal-pad" | "number-pad";
  icon?: string;
  accent?: boolean;
  highlighted?: boolean;
  a11y?: string;
}) {
  const { color } = useTheme();
  const ink = accent ? color.accentInk : color.inkFaint;
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        {icon ? <NavIcon d={icon} size={12} color={ink} /> : null}
        <Text style={styles.label(ink)}>{label}</Text>
      </View>
      <TextInput
        accessibilityLabel={a11y ?? label}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboard}
        style={[styles.input, { color: color.ink, backgroundColor: color.surface, borderColor: highlighted ? color.accent : color.line }]}
      />
    </View>
  );
}

const styles = {
  ...StyleSheet.create({
    body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 16 },
    circuit: { gap: 10, borderRadius: 20, borderLeftWidth: 3, padding: 8, paddingLeft: 9 },
    note: { marginTop: 10, borderRadius: 12, borderLeftWidth: 3, paddingVertical: 6, paddingLeft: 10, paddingRight: 8 },
    chip: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
    input: { height: 44, width: 68, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, fontFamily: font.regular, fontSize: 14 },
    logSet: { marginLeft: "auto", height: 44, minWidth: 92, alignItems: "center", justifyContent: "center", borderRadius: 16, paddingHorizontal: 20 },
  }),
  kicker: (ink: string) => ({ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" as const, color: ink }),
  label: (ink: string) => ({ fontFamily: font.semibold, fontSize: 10, letterSpacing: 0.6, textTransform: "uppercase" as const, color: ink }),
  title: (ink: string) => ({ fontFamily: font.displayExtrabold, fontSize: 24, color: ink }),
};
