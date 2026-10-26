import type { TrainingLoadV1, WorkoutExerciseV1, WorkoutHistoryV1 } from "@healthapp/api/v1";
import { circuitSegments, formatSetDuration } from "@healthapp/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AthleteFigure, LoadBadge, loadTone } from "@/components/training";
import { Card, Divider, NavIcon, T } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { setsByExercise } from "@/lib/logger-model";
import { useOfflineQuery } from "@/lib/offline-query";
import { queuedForDay } from "@/lib/outbox-core";
import { useOutbox } from "@/lib/outbox";
import { alpha, font, useTheme } from "@/lib/theme";

// A training day, opened from Training — the web's /workout/[dayId] on a phone,
// one column: the header with the day's athlete, the start button, every
// exercise with its prescription (circuits grouped), the last session's load,
// and every past session with its sets. Opening it also keeps the day on the
// phone, so the logger behind it works with no signal.


export default function WorkoutDayScreen() {
  const { dayId } = useLocalSearchParams<{ dayId: string }>();
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const { session } = useAuth();
  const outbox = useOutbox();
  const query = useOfflineQuery(`day:${dayId}`, ["workout", dayId], () => api.workoutDay(dayId));
  const day = query.data?.data;
  const d = t.clientApp.workoutDay;

  const waiting = day && session ? queuedForDay(outbox.items, session.user.id, day.day_id) : [];
  const sets = day ? setsByExercise(day, waiting) : {};
  const logged = Object.values(sets).some((list) => list.length > 0);
  const doneToday = Boolean(day?.completed) && logged;
  const inProgress = logged && !day?.completed;
  const history = day?.history ?? [];
  const last = history[0] ?? null;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body}>
        <Pressable
          accessibilityRole="link"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/workout"))}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 4 }}
        >
          <NavIcon d="m15 6-6 6 6 6" size={14} color={color.inkFaint} />
          <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkFaint }}>{t.common.nav.training}</Text>
        </Pressable>

        {!day ? (
          query.isError ? (
            <T kind="soft">{t.mobile.workout.needsDayFirst}</T>
          ) : (
            <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
          )
        ) : (
          <>
            {/* the header: what the day is, and who trains it */}
            <Card style={{ gap: 0, minHeight: 200, flexDirection: "row", overflow: "hidden" }}>
              <View style={{ flex: 1, minWidth: 0, paddingVertical: 20, paddingLeft: 20, paddingRight: 4 }}>
                <Text numberOfLines={1} style={styles.kicker(color.inkFaint)}>
                  {`${day.program_name} · ${day.intensity_mode.toUpperCase()}`}
                </Text>
                <Text style={{ marginTop: 8, fontFamily: font.displayExtrabold, fontSize: 26, lineHeight: 28, color: color.ink }}>{day.day_name}</Text>
                <Text style={{ marginTop: 8, fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>
                  {fill(t.clientApp.workout.exercisesCount, { count: day.exercises.length })}
                </Text>
                {inProgress || doneToday ? (
                  <View style={{ marginTop: "auto", paddingTop: 16 }}>
                    <View style={{ alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, backgroundColor: doneToday ? color.accentSoft : color.warnSoft }}>
                      <Text style={{ fontFamily: font.bold, fontSize: 11, color: doneToday ? color.accentInk : color.warn }}>
                        {doneToday ? t.clientApp.today.doneToday : t.clientApp.workout.inProgress}
                      </Text>
                    </View>
                  </View>
                ) : null}
              </View>
              {day.type ? (
                <View pointerEvents="none" style={{ width: "42%" }}>
                  <AthleteFigure type={day.type} sex={day.sex} seed={day.day_id} />
                </View>
              ) : null}
            </Card>

            {query.data?.fromPhone ? <T kind="faint">{t.mobile.workout.fromPhone}</T> : null}

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/workout/[dayId]/log", params: { dayId: day.day_id } })}
              style={({ pressed }) => [styles.start, { backgroundColor: color.accent, opacity: pressed ? 0.9 : 1 }]}
            >
              <NavIcon d="M7 4v16l13-8z" size={18} color={color.accentFg} strokeWidth={2.2} />
              <Text style={{ fontFamily: font.displayBold, fontSize: 15, color: color.accentFg }}>
                {doneToday ? d.addSets : inProgress ? d.continueWorkout : d.start}
              </Text>
            </Pressable>

            {/* the plan */}
            <View>
              <Text style={[styles.kicker(color.inkFaint), { marginBottom: 10, paddingHorizontal: 4 }]}>
                {`${d.exercises} · ${fill(t.clientApp.workout.exercisesCount, { count: day.exercises.length })}`}
              </Text>
              <View style={{ gap: 10 }}>
                {circuitSegments(day.exercises).map((seg, si) =>
                  seg.circuit !== null ? (
                    <View key={seg.circuit} style={[styles.circuit, { borderLeftColor: color.accent, backgroundColor: alpha(color.accentSoft, 0.55) }]}>
                      {seg.label ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingTop: 2 }}>
                          <NavIcon d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" size={13} color={color.accentInk} />
                          <Text style={{ fontFamily: font.bold, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: color.accentInk }}>
                            {fill(t.coachWidgets.programBuilder.circuitName, { label: seg.label })}
                          </Text>
                        </View>
                      ) : null}
                      {seg.exercises.map((e) => <ExerciseRow key={e.id} e={e} mode={day.intensity_mode} />)}
                    </View>
                  ) : (
                    <View key={`solo-${si}`} style={{ gap: 10 }}>
                      {seg.exercises.map((e) => <ExerciseRow key={e.id} e={e} mode={day.intensity_mode} />)}
                    </View>
                  ),
                )}
              </View>
            </View>

            {/* what happened before */}
            {last ? <LoadCard load={last.load} when={last.ago} /> : null}

            <View>
              <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10, paddingHorizontal: 4 }}>
                <Text style={{ fontFamily: font.bold, fontSize: 14, color: color.ink }}>{d.history}</Text>
                <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>
                  {history.length === 1 ? d.sessionOne : fill(d.sessionsCount, { count: history.length })}
                </Text>
              </View>
              <History sessions={history} locale={locale} />
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** One exercise: name and prescription on the surface, the coach's cue under it (DayExerciseRow). */
function ExerciseRow({ e, mode }: { e: WorkoutExerciseV1; mode: "rpe" | "rir" | "simple" }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const scale = mode === "rpe" ? "RPE" : "RIR";
  const prescription = `${e.sets}×${e.reps}${e.measure === "time" ? " s" : ""}${e.target_rpe !== null && mode !== "simple" ? ` · ${scale} ${e.target_rpe}` : ""}${e.weight_kg ? ` · ${e.weight_kg} kg` : ""}`;
  return (
    <View>
      <Pressable
        accessibilityRole={e.exercise_id ? "link" : undefined}
        disabled={!e.exercise_id}
        onPress={e.exercise_id ? () => router.push({ pathname: "/exercise/[id]", params: { id: e.exercise_id! } }) : undefined}
        style={[styles.exercise, { backgroundColor: color.surface }]}
      >
        <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: font.semibold, fontSize: 15, color: color.ink }}>{e.name}</Text>
        <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>{prescription}</Text>
      </Pressable>
      {e.notes ? (
        <View style={[styles.cue, { borderLeftColor: color.accent, backgroundColor: alpha(color.accentSoft, 0.4) }]}>
          <Text style={{ fontFamily: font.semibold, fontSize: 10, letterSpacing: 0.6, textTransform: "uppercase", color: color.accentInk }}>
            {t.clientWidgets.setLogger.coachNote}
          </Text>
          <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 13, color: color.ink }}>{e.notes}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** The last session's load: the number, its band, the five-band meter, the facts (TrainingLoadCard). */
function LoadCard({ load, when }: { load: TrainingLoadV1; when: string }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const l = t.common.trainingLoad;
  const tone = loadTone(load.category, color);
  const facts = [
    load.duration_min !== null ? fill(l.minutes, { min: load.duration_min }) : null,
    load.exercises > 0 ? fill(l.exercises, { count: load.exercises }) : null,
    `${load.sets} ${t.clientApp.workoutDay.sets}`,
    `${load.volume_kg.toLocaleString(locale === "ro" ? "ro-RO" : "en-GB")} kg`,
  ].filter((x): x is string => x !== null);
  const bands = [30, 20, 20, 15, 15];
  const index = ["very_light", "light", "moderate", "hard", "very_hard"].indexOf(load.category);
  return (
    <Card style={{ gap: 0 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", columnGap: 12 }}>
        <Text style={styles.kicker(color.inkFaint)}>{l.title}</Text>
        <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{`${l.lastSession} · ${when}`}</Text>
      </View>
      <View style={{ marginTop: 8, flexDirection: "row", alignItems: "baseline", gap: 12 }}>
        <Text style={{ fontFamily: font.displayExtrabold, fontSize: 40, lineHeight: 42, color: color.ink }}>{load.score}</Text>
        <Text style={{ fontFamily: font.semibold, fontSize: 16, color: tone.ink }}>{l.category[load.category]}</Text>
      </View>
      <View style={{ marginTop: 12 }}>
        <View style={{ height: 8, borderRadius: 999, overflow: "hidden", backgroundColor: color.bg }}>
          <View style={{ height: "100%", width: `${load.score}%`, borderRadius: 999, backgroundColor: tone.bar }} />
        </View>
        <View style={{ marginTop: 4, flexDirection: "row", gap: 2 }}>
          {bands.map((w, i) => (
            <View key={i} style={{ height: 2, width: `${w}%`, borderRadius: 999, backgroundColor: i <= index ? tone.bar : color.line }} />
          ))}
        </View>
      </View>
      <Text style={{ marginTop: 10, fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>{facts.join(" · ")}</Text>
      <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 11, lineHeight: 15, color: color.inkFaint }}>{l.explainer}</Text>
    </Card>
  );
}

/** "60 kg × 8", or "45 s" / "10 kg · 45 s" for a timed set (workout-history.tsx setText). */
function setText(s: { weight_kg: number; reps: number; duration_seconds: number | null }): string {
  if (s.duration_seconds) return `${s.weight_kg > 0 ? `${s.weight_kg} kg · ` : ""}${formatSetDuration(s.duration_seconds)}`;
  return `${s.weight_kg} kg × ${s.reps}`;
}

/** Past sessions, newest first; the latest opens unfolded (WorkoutHistory). */
function History({ sessions, locale }: { sessions: WorkoutHistoryV1[]; locale: string }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const d = t.clientApp.workoutDay;
  const [open, setOpen] = useState<Set<string>>(() => new Set(sessions.slice(0, 1).map((s) => s.id)));
  if (sessions.length === 0) return <T kind="faint" style={{ paddingHorizontal: 4, fontSize: 14 }}>{d.noHistory}</T>;
  const tag = locale === "ro" ? "ro-RO" : "en-GB";
  const fmt = new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <View style={{ gap: 10 }}>
      {sessions.map((s) => {
        const unfolded = open.has(s.id);
        return (
          <Card key={s.id} style={{ padding: 0, gap: 0 }}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: unfolded }} onPress={() => toggle(s.id)} style={styles.sessionHead}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 15, color: color.ink }}>{fmt.format(new Date(s.at))}</Text>
                <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
                  {`${s.sets} ${d.sets} · ${s.volume_kg.toLocaleString(tag)} kg ${d.volume}`}
                  {s.prs > 0 ? <Text style={{ fontFamily: font.semibold, color: color.accentInk }}>{` · ${s.prs} ${s.prs === 1 ? d.prOne : d.prs}`}</Text> : null}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 6 }}>
                <LoadBadge load={s.load} showLabel={false} />
                <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkFaint }}>{unfolded ? d.hideSets : d.showSets}</Text>
              </View>
            </Pressable>
            {unfolded ? (
              <>
                <Divider />
                <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 18, gap: 14 }}>
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => router.push({ pathname: "/session/[id]", params: { id: s.id } })}
                    style={[styles.smallPill, { backgroundColor: color.bg }]}
                  >
                    <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkSoft }}>{t.coachWidgets.workoutFeedback.openWorkout}</Text>
                  </Pressable>
                  {s.exercises.map((exercise) => (
                    <View key={exercise.name}>
                      <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{exercise.name}</Text>
                      <View style={{ marginTop: 6, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                        {exercise.sets.map((x) => (
                          <View key={x.id} style={[styles.setChip, { backgroundColor: x.is_pr ? color.accent : color.bg }]}>
                            <Text style={{ fontFamily: x.is_pr ? font.semibold : font.regular, fontSize: 12, color: x.is_pr ? color.accentFg : color.inkSoft }}>
                              {`${setText(x)}${x.rir !== null ? ` · ${d.rir} ${x.rir}` : ""}${x.rpe !== null ? ` · ${x.rpe}/10 ${d.intensity}` : ""}`}
                            </Text>
                          </View>
                        ))}
                      </View>
                      {exercise.sets.some((x) => x.notes) ? (
                        <View style={{ marginTop: 6, gap: 2 }}>
                          {exercise.sets
                            .filter((x) => x.notes)
                            .map((x) => (
                              <Text key={`${x.id}-note`} style={{ fontFamily: font.regular, fontStyle: "italic", fontSize: 12, color: color.inkFaint }}>
                                {`#${x.set_index}: ${x.notes}`}
                              </Text>
                            ))}
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}

const styles = {
  ...StyleSheet.create({
    body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 20 },
    start: { height: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 16, paddingHorizontal: 24 },
    circuit: { gap: 8, borderRadius: 20, borderLeftWidth: 3, padding: 8, paddingLeft: 9 },
    exercise: { flexDirection: "row", alignItems: "baseline", gap: 14, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 14 },
    cue: { marginHorizontal: 8, marginTop: -4, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, borderLeftWidth: 3, paddingHorizontal: 12, paddingVertical: 8 },
    sessionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 20, paddingVertical: 16 },
    smallPill: { alignSelf: "flex-start", height: 36, justifyContent: "center", borderRadius: 999, paddingHorizontal: 14 },
    setChip: { minHeight: 32, justifyContent: "center", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  }),
  kicker: (ink: string) => ({ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" as const, color: ink }),
};
