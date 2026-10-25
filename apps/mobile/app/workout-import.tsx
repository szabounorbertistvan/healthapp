import type { ImportPreviewV1 } from "@healthapp/api/v1";
import { useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { router } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// Import workout history — the web's /workout/import on a phone
// (components/workout-import.tsx): pick the CSV that Hevy, Strong, Fitbod,
// FitNotes or the Voinic template wrote; it is read by the web's own reader
// (/api/v1/import/preview) and each exercise name matched to the library; the
// person settles the rest (a shortlist or skip); then the workouts go a few
// days at a time to the same importWorkoutChunk(), and the PR flags of every
// lift touched are re-derived. Importing the same file again adds nothing.

type Parsed = Extract<ImportPreviewV1, { ok: true }>;
type Choice = string | "skip" | null;
type Totals = { sessions: number; sets: number; already: number; dayTaken: number; future: number };
const SESSIONS_PER_CALL = 20;
const LIFTS_PER_FINISH = 10;
const MAX_MB = 15;

export default function WorkoutImport() {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const m = t.clientApp.workoutImport;
  const [csv, setCsv] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [phase, setPhase] = useState<"review" | "running" | "records" | "done">("review");
  const [progress, setProgress] = useState(0);
  const [totals, setTotals] = useState<Totals | null>(null);
  const df = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" });

  async function read(text: string, unit?: "kg" | "lb") {
    const r = await api.importPreview(text, unit);
    if (!r.ok) {
      setParsed(null);
      setError(r.error === "empty" ? m.errEmpty : r.error === "unknownFormat" ? m.errUnknown : r.error === "tooLarge" ? fill(m.errTooLarge, { mb: MAX_MB }) : m.errNoSessions);
      return;
    }
    setParsed(r);
    setChoices(Object.fromEntries(r.names.map((n) => [n.name, n.match])));
  }

  async function pick() {
    setError(null);
    setTotals(null);
    setPhase("review");
    const res = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "application/vnd.ms-excel", "text/plain", "*/*"], copyToCacheDirectory: true });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    if (asset.size && asset.size > MAX_MB * 1024 * 1024) return setError(fill(m.errTooLarge, { mb: MAX_MB }));
    setReading(true);
    try {
      const text = Platform.OS === "web" && asset.file ? await asset.file.text() : await new File(asset.uri).text();
      setCsv(text);
      await read(text);
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : m.errRead);
    } finally {
      setReading(false);
    }
  }

  async function run() {
    if (!parsed) return;
    setError(null);
    setPhase("running");
    setProgress(0);
    const sessions = parsed.sessions
      .map((s) => ({
        title: s.title,
        startLocal: s.startLocal,
        durationMinutes: s.durationMinutes,
        notes: s.notes,
        sets: s.sets.flatMap((x) => {
          const id = choices[x.exercise];
          return id && id !== "skip" ? [{ ordinal: x.ordinal, exerciseId: id, weightKg: x.weightKg, reps: x.reps, durationSeconds: x.durationSeconds, rpe: x.rpe, notes: x.notes }] : [];
        }),
      }))
      .filter((s) => s.sets.length > 0);
    // Whole days per call (the server's same-day rule needs a day's workouts together).
    const calls: (typeof sessions)[] = [];
    let current: typeof sessions = [];
    sessions.forEach((s, i) => {
      current.push(s);
      const nextDay = sessions[i + 1]?.startLocal.slice(0, 10);
      if (current.length >= SESSIONS_PER_CALL && nextDay !== s.startLocal.slice(0, 10)) {
        calls.push(current);
        current = [];
      }
    });
    if (current.length > 0) calls.push(current);
    const sum: Totals = { sessions: 0, sets: 0, already: 0, dayTaken: 0, future: 0 };
    let done = 0;
    try {
      for (const call of calls) {
        const r = await api.importChunk(call);
        if (!r.ok) {
          setError(r.message ?? m.errWrite);
          setTotals(sum);
          setPhase("review");
          return;
        }
        sum.sessions += r.sessions ?? 0;
        sum.sets += r.sets ?? 0;
        sum.already += r.already ?? 0;
        sum.dayTaken += r.dayTaken ?? 0;
        sum.future += r.future ?? 0;
        done += call.length;
        setProgress(done);
      }
      setPhase("records");
      const lifts = [...new Set(sessions.flatMap((s) => s.sets.map((x) => x.exerciseId)))];
      for (let i = 0; i < lifts.length; i += LIFTS_PER_FINISH) {
        const r = await api.importFinish(lifts.slice(i, i + LIFTS_PER_FINISH));
        if (!r.ok) {
          setError(r.message ?? m.errWrite);
          break;
        }
      }
    } catch {
      setError(m.errWrite);
      setTotals(sum);
      setPhase("review");
      return;
    }
    setTotals(sum);
    setPhase("done");
    for (const key of ["workouts", "today", "progress", "streak", "fitness-score"]) void queryClient.invalidateQueries({ queryKey: [key] });
  }

  const reset = () => { setCsv(null); setParsed(null); setChoices({}); setTotals(null); setError(null); setPhase("review"); };
  const names = parsed?.names ?? [];
  const unresolved = names.filter((n) => (choices[n.name] ?? null) === null).length;
  const setCount = parsed?.sessions.reduce((n, s) => n + s.sets.length, 0) ?? 0;
  const starting = parsed ? parsed.sessions.filter((s) => s.sets.some((x) => { const c = choices[x.exercise]; return c && c !== "skip"; })).length : 0;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <BackHeader label={t.clientApp.workoutDay.backToTraining} />
        <T kind="title">{m.title}</T>

        {phase === "done" && totals ? (
          <Card style={{ gap: 8 }}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{m.doneTitle}</Text>
            <T kind="soft">{fill(m.doneBody, { sessions: totals.sessions, sets: totals.sets })}</T>
            {totals.already > 0 ? <T kind="faint">{fill(m.doneAlready, { n: totals.already })}</T> : null}
            {totals.dayTaken > 0 ? <T kind="faint">{fill(m.doneDayTaken, { n: totals.dayTaken })}</T> : null}
            {totals.future > 0 ? <T kind="faint">{fill(m.doneFuture, { n: totals.future })}</T> : null}
            {error ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center", marginTop: 4 }}>
              <Button height={42} label={m.seeHistory} onPress={() => router.navigate("/workout")} />
              <Text accessibilityRole="button" onPress={reset} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{m.another}</Text>
            </View>
          </Card>
        ) : !parsed ? (
          <Card style={{ gap: 10 }}>
            <T kind="soft" style={{ lineHeight: 19 }}>{m.intro}</T>
            {[m.howHevy, m.howStrong, m.howFitbod, m.howFitNotes].map((line) => <T key={line} kind="faint">{line}</T>)}
            <Text style={{ marginTop: 4, fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{m.templateTitle}</Text>
            <T kind="faint" style={{ lineHeight: 18 }}>{m.templateBody}</T>
            <View style={{ alignSelf: "flex-start", marginTop: 6 }}>
              <Button height={44} label={reading ? m.reading : m.pickFile} busy={reading} onPress={() => void pick()} />
            </View>
            {error ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
          </Card>
        ) : (
          <>
            <Card style={{ gap: 8 }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>
                {fill(m.detected, {
                  app: m.formats[parsed.format],
                  sessions: parsed.sessions.length,
                  sets: setCount,
                  from: parsed.sessions[0] ? df.format(new Date(parsed.sessions[0].startLocal)) : "",
                  to: parsed.sessions.length ? df.format(new Date(parsed.sessions[parsed.sessions.length - 1]!.startLocal)) : "",
                })}
              </Text>
              {!parsed.unit_from_file && csv ? (
                <View style={{ gap: 6 }}>
                  <T kind="soft">{m.unitQuestion}</T>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {(["kg", "lb"] as const).map((u) => (
                      <Pressable key={u} accessibilityRole="radio" accessibilityState={{ checked: parsed.weight_unit === u }} onPress={() => void read(csv, u)} style={[styles.chip, { backgroundColor: parsed.weight_unit === u ? color.accent : color.bg }]}>
                        <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: parsed.weight_unit === u ? color.accentFg : color.inkSoft }}>{u}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
              {parsed.skipped.warmups > 0 ? <T kind="faint">{fill(m.skippedWarmups, { n: parsed.skipped.warmups })}</T> : null}
              {parsed.skipped.cardio > 0 ? <T kind="faint">{fill(m.skippedCardio, { n: parsed.skipped.cardio })}</T> : null}
              {parsed.skipped.invalid > 0 ? <T kind="faint">{fill(m.skippedInvalid, { n: parsed.skipped.invalid })}</T> : null}
            </Card>

            <Card style={{ gap: 10 }}>
              <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{m.reviewTitle}</Text>
              <T kind="faint">{m.reviewHint}</T>
              {names.map((n) => (
                <NameRow key={n.name} row={n} choice={choices[n.name] ?? null} onChoose={(c) => setChoices((x) => ({ ...x, [n.name]: c }))} disabled={phase !== "review"} />
              ))}
            </Card>

            <Card style={{ gap: 8 }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{m.rulesTitle}</Text>
              <T kind="faint" style={{ lineHeight: 18 }}>{m.rulesBody}</T>
              {unresolved > 0 ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.warn }}>{fill(m.unresolved, { n: unresolved })}</Text> : null}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 }}>
                <Button
                  height={44}
                  label={phase === "running" ? fill(m.importing, { done: progress, total: starting }) : phase === "records" ? m.updatingRecords : fill(m.start, { n: starting })}
                  busy={phase === "running" || phase === "records"}
                  disabled={unresolved > 0 || starting === 0}
                  onPress={() => void run()}
                />
                {phase === "review" ? <Text accessibilityRole="button" onPress={reset} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{t.common.actions.cancel}</Text> : null}
              </View>
              {error ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** One exercise name from the file: matched, skipped, or waiting — the shortlist and a library search to settle it. */
function NameRow({ row, choice, onChoose, disabled }: {
  row: Parsed["names"][number]; choice: Choice; onChoose: (c: Choice) => void; disabled: boolean;
}) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const m = t.clientApp.workoutImport;
  const [open, setOpen] = useState(choice === null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; name: string }[]>([]);
  const chosen = choice && choice !== "skip" ? row.suggestions.find((s) => s.id === choice)?.name ?? hits.find((h) => h.id === choice)?.name ?? null : null;
  const state = choice === null ? { label: m.needsMatch, ink: color.warn } : choice === "skip" ? { label: m.skippedLabel, ink: color.inkFaint } : { label: m.matched, ink: color.accentInk };

  async function search(text: string) {
    setQ(text);
    if (text.trim().length < 2) return setHits([]);
    const r = await api.searchExercises(text.trim(), "").catch(() => null);
    if (r) setHits(r.results.slice(0, 8).map((x) => ({ id: x.id, name: x.name })));
  }

  return (
    <View style={[styles.name, { backgroundColor: color.bg }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={2} style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{row.name}</Text>
          <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{`${fill(m.sets, { n: row.sets })}${chosen ? ` · → ${chosen}` : ""}`}</Text>
        </View>
        <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: state.ink }}>{state.label}</Text>
        {!open && !disabled ? <Text accessibilityRole="button" onPress={() => setOpen(true)} style={{ fontFamily: font.semibold, fontSize: 12, color: color.accentInk }}>{m.change}</Text> : null}
      </View>
      {open && !disabled ? (
        <View style={{ gap: 6, marginTop: 8 }}>
          {row.suggestions.length > 0 ? <T kind="label">{m.suggestions}</T> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {[...row.suggestions, ...hits.filter((h) => !row.suggestions.some((s) => s.id === h.id))].map((s) => (
              <Pressable key={s.id} accessibilityRole="radio" accessibilityState={{ checked: choice === s.id }} onPress={() => { onChoose(s.id); setOpen(false); }} style={[styles.chip, { backgroundColor: choice === s.id ? color.accent : color.surface }]}>
                <Text numberOfLines={1} style={{ maxWidth: 220, fontFamily: font.semibold, fontSize: 12, color: choice === s.id ? color.accentFg : color.inkSoft }}>{s.name}</Text>
              </Pressable>
            ))}
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: choice === "skip" }} onPress={() => { onChoose("skip"); setOpen(false); }} style={[styles.chip, { backgroundColor: choice === "skip" ? color.inkSoft : color.surface }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 12, color: choice === "skip" ? color.bg : color.inkSoft }}>{m.skip}</Text>
            </Pressable>
          </View>
          <TextInputRow value={q} onChange={(v) => void search(v)} placeholder={m.search} />
          {q.trim().length >= 2 && hits.length === 0 ? <T kind="faint">{m.noResults}</T> : null}
        </View>
      ) : null}
    </View>
  );
}

function TextInputRow({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const { color } = useTheme();
  return <TextInput value={value} onChangeText={onChange} autoCorrect={false} placeholder={placeholder} placeholderTextColor={color.inkFaint} accessibilityLabel={placeholder} style={[styles.search, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }]} />;
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  chip: { minHeight: 32, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, justifyContent: "center" },
  name: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  search: { height: 40, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, fontFamily: font.regular, fontSize: 13.5 },
});
