import type { BuilderExerciseV1, BuilderV1, ExerciseHitV1 } from "@healthapp/api/v1";
import { displayToKg, kgToDisplay, parseDecimal, type WeightUnit } from "@healthapp/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { absolute } from "@/components/post-card";
import { Button, Card, NavIcon, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/role";
import { font, useTheme } from "@/lib/theme";

// The program builder — the web's /workout/build on a phone (solo-program-builder.tsx
// with its day editor): your own programs, one open at a time; its days (name,
// muscle groups, order, copy, delete), the exercises in each from the library,
// and their prescription (sets × reps, RIR, kg, rest, reps or time, your cue);
// then publish, set as active, delete. Every write is the web's own builder
// action through /api/v1/builder; a coached client is shown their coach's role.

// The 17 groups the library uses (components/muscle-group-picker.tsx MUSCLE_GROUPS).
const MUSCLE_GROUPS = [
  "chest", "lats", "middle back", "lower back", "shoulders", "traps",
  "biceps", "triceps", "forearms", "abdominals", "quadriceps", "hamstrings",
  "glutes", "calves", "adductors", "abductors", "neck",
] as const;

const UP = "m6 15 6-6 6 6";
const DOWN = "m6 9 6 6 6-6";
const COPY = "M9 9h11v11H9zM5 15H4V4h11v1";
const CLOSE = "M6 6 18 18M18 6 6 18";
const PENCIL = "M4 20h4l10-10-4-4L4 16zM13 7l4 4";

type Run = (op: string, body?: Record<string, unknown>) => Promise<{ ok: boolean; id?: string }>;

/** One builder action, then the builder and Training read again; a refusal shows its sentence. */
function useRun(setError: (m: string | null) => void): [Run, boolean] {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run: Run = async (op, body = {}) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.build(op, body);
      if (!r.ok) setError(r.message ?? t.coachWidgets.programBuilder.somethingWentWrong);
      await queryClient.invalidateQueries({ queryKey: ["builder"] });
      void queryClient.invalidateQueries({ queryKey: ["workouts"] });
      void queryClient.invalidateQueries({ queryKey: ["today"] });
      return r;
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : t.coachWidgets.programBuilder.somethingWentWrong);
      return { ok: false };
    } finally {
      setBusy(false);
    }
  };
  return [run, busy];
}

export default function Build() {
  const params = useLocalSearchParams<{ program?: string }>();
  const { t } = useI18n();
  const { color } = useTheme();
  const b = t.clientApp.builder;
  const [programId, setProgramId] = useState<string | undefined>(params.program);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, busy] = useRun(setError);
  const query = useQuery({ queryKey: ["builder", programId ?? null], queryFn: () => api.builder(programId) });
  const data = query.data;
  const unit: WeightUnit = useMe().data?.data.weight_unit ?? "kg";

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.clientApp.workoutDay.backToTraining} />
        <T kind="title">{b.title}</T>

        {!data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : data.coached ? (
          <Card style={{ gap: 6 }}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{t.clientApp.coachConnect.coachManagesTitle}</Text>
            <T kind="soft" style={{ lineHeight: 19 }}>{t.clientApp.coachConnect.coachManagesBody}</T>
            <View style={{ marginTop: 10, alignSelf: "flex-start" }}>
              <Button height={42} label={t.clientApp.workoutDay.backToTraining} onPress={() => router.back()} />
            </View>
          </Card>
        ) : (
          <>
            {data.programs.length > 0 ? (
              <Switcher data={data} creating={creating} onPick={(id) => { setCreating(false); setProgramId(id); }} onNew={() => setCreating(true)} />
            ) : null}
            {creating || !data.open ? (
              <CreateForm
                first={data.programs.length === 0}
                onCancel={data.open ? () => setCreating(false) : undefined}
                onCreated={(id) => { setCreating(false); setProgramId(id); }}
              />
            ) : (
              <ProgramEditor program={data.open} run={run} busy={busy} unit={unit} onDeleted={() => setProgramId(undefined)} />
            )}
            {error ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.risk }}>{error}</Text> : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** "Your programs": one chip each, the open one in gold, then New program. */
function Switcher({ data, creating, onPick, onNew }: { data: BuilderV1; creating: boolean; onPick: (id: string) => void; onNew: () => void }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const b = t.clientApp.builder;
  return (
    <View style={{ gap: 8 }}>
      <T kind="label">{b.yourPrograms}</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {data.programs.map((p) => {
          const on = !creating && p.id === data.open?.id;
          return (
            <Pressable key={p.id} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onPick(p.id)} style={[styles.program, { backgroundColor: on ? color.accent : color.surface, borderColor: on ? color.accent : color.line }]}>
              <Text numberOfLines={1} style={{ maxWidth: 180, fontFamily: font.semibold, fontSize: 13.5, color: on ? color.accentFg : color.ink }}>{p.name}</Text>
              <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: on ? color.accentFg : color.inkFaint }}>
                {`${p.status === "published" ? b.published : b.draft} · ${p.days === 1 ? b.dayCountOne : fill(b.dayCount, { count: p.days })}`}
              </Text>
            </Pressable>
          );
        })}
        <Pressable accessibilityRole="button" onPress={onNew} style={[styles.program, { justifyContent: "center", backgroundColor: creating ? color.accentSoft : color.bg, borderColor: color.line, borderStyle: "dashed" }]}>
          <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.accentInk }}>{`+ ${b.newProgram}`}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

/** A new program: its name. Every solo program counts effort in RIR, as on the web. */
function CreateForm({ first, onCreated, onCancel }: { first: boolean; onCreated: (id: string) => void; onCancel?: () => void }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const b = t.clientApp.builder;
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [run, busy] = useRun(setError);
  return (
    <Card style={{ gap: 12 }}>
      <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{first ? b.create : b.newProgram}</Text>
      {first ? null : <T kind="soft" style={{ lineHeight: 19 }}>{b.newProgramHint}</T>}
      <TextInput
        value={name}
        onChangeText={setName}
        maxLength={120}
        placeholder={b.namePlaceholder}
        placeholderTextColor={color.inkFaint}
        accessibilityLabel={b.namePlaceholder}
        style={[styles.field, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Button
          height={42}
          label={b.create}
          busy={busy}
          disabled={!name.trim()}
          onPress={async () => {
            const r = await run("create", { name });
            if (r.ok && r.id) {
              setName("");
              onCreated(r.id);
            }
          }}
        />
        {onCancel ? <Text accessibilityRole="button" onPress={onCancel} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{b.cancel}</Text> : null}
      </View>
      {error ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
    </Card>
  );
}

type Open = NonNullable<BuilderV1["open"]>;

function ProgramEditor({ program, run, busy, unit, onDeleted }: { program: Open; run: Run; busy: boolean; unit: WeightUnit; onDeleted: () => void }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const b = t.clientApp.builder;
  const m = t.coachWidgets.programBuilder;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const published = program.status === "published";
  const hasExercise = program.days.some((d) => d.exercises.length > 0);
  const status = !published
    ? { label: b.draft, hint: b.statusDraftHint, on: false }
    : program.activation === null
      ? { label: b.published, hint: b.statusUnknown, on: false }
      : program.activation.followed
        ? { label: b.statusActive, hint: b.statusActiveHint, on: true }
        : { label: b.statusInactive, hint: b.statusInactiveHint, on: false };
  const intensity = program.intensity_mode === "rpe" ? "RPE" : "RIR";

  return (
    <View style={{ gap: 14 }}>
      <Card style={{ gap: 10 }}>
        <Text style={{ fontFamily: font.displayExtrabold, fontSize: 20, letterSpacing: -0.3, color: color.ink }}>{program.name}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <T kind="label">{b.statusLabel}</T>
          <View style={[styles.badge, { backgroundColor: status.on ? color.accentSoft : color.surface }]}>
            <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: status.on ? color.accentInk : color.inkSoft }}>{status.label}</Text>
          </View>
        </View>
        <T kind="soft" style={{ lineHeight: 19 }}>{status.hint}</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 4 }}>
          {!published ? (
            <Button height={40} label={b.publish} busy={busy} disabled={!hasExercise} onPress={() => void run("publish", { programId: program.id })} />
          ) : program.activation && !program.activation.followed ? (
            <Button height={40} label={b.setActive} busy={busy} onPress={() => void run("activate", { programId: program.id })} />
          ) : null}
          {confirmDelete ? null : (
            <Text accessibilityRole="button" onPress={() => setConfirmDelete(true)} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{b.deleteProgram}</Text>
          )}
        </View>
        {!published && !hasExercise ? <T kind="faint">{m.publishHint}</T> : published ? null : <T kind="faint">{b.publishHint}</T>}
        {confirmDelete ? (
          <View style={[styles.confirm, { backgroundColor: color.riskSoft }]}>
            <Text style={{ fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.ink }}>{fill(b.deleteConfirm, { name: program.name })}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={async () => {
                  const r = await run("delete", { programId: program.id });
                  if (r.ok) onDeleted();
                }}
                style={[styles.danger, { backgroundColor: color.risk, opacity: busy ? 0.5 : 1 }]}
              >
                <Text style={{ fontFamily: font.bold, fontSize: 13, color: color.bg }}>{b.deleteProgram}</Text>
              </Pressable>
              <Text accessibilityRole="button" onPress={() => setConfirmDelete(false)} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{b.cancel}</Text>
            </View>
          </View>
        ) : null}
      </Card>

      {program.days.length === 0 ? <T kind="soft">{b.noDays}</T> : null}
      {program.days.map((day, i) => (
        <DayEditor
          key={day.id}
          programId={program.id}
          day={day}
          first={i === 0}
          last={i === program.days.length - 1}
          intensity={intensity}
          unit={unit}
          run={run}
          busy={busy}
        />
      ))}
      <AddDay programId={program.id} count={program.days.length} run={run} busy={busy} />
    </View>
  );
}

type Day = Open["days"][number];

function DayEditor({ programId, day, first, last, intensity, unit, run, busy }: {
  programId: string; day: Day; first: boolean; last: boolean; intensity: string; unit: WeightUnit; run: Run; busy: boolean;
}) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const m = t.coachWidgets.programBuilder;
  const w = t.clientApp.workout;
  const [renaming, setRenaming] = useState(false);
  // Return and the blur that follows it both end the edit; the ref lets only the first one save.
  const renamed = useRef(false);
  function rename() {
    if (renamed.current) return;
    renamed.current = true;
    setRenaming(false);
    if (name.trim() && name.trim() !== day.name) void run("renameDay", { programId, dayId: day.id, name });
  }
  const [name, setName] = useState(day.name);
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setName(day.name), [day.name]);

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        {renaming ? (
          <TextInput
            autoFocus
            value={name}
            onChangeText={setName}
            maxLength={80}
            accessibilityLabel={m.renameDay}
            onSubmitEditing={rename}
            onBlur={rename}
            style={[styles.field, { flex: 1, height: 40, color: color.ink, backgroundColor: color.bg, borderColor: color.accent }]}
          />
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel={m.renameDay} onPress={() => { renamed.current = false; setRenaming(true); }} style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{day.name}</Text>
            <NavIcon d={PENCIL} size={14} color={color.inkFaint} />
          </Pressable>
        )}
        <IconButton d={UP} label={m.moveUp} disabled={busy || first} onPress={() => void run("moveDay", { programId, dayId: day.id, direction: -1 })} />
        <IconButton d={DOWN} label={m.moveDown} disabled={busy || last} onPress={() => void run("moveDay", { programId, dayId: day.id, direction: 1 })} />
        <IconButton d={COPY} label={m.duplicate} disabled={busy} onPress={() => void run("duplicateDay", { programId, dayId: day.id })} />
        <IconButton d={CLOSE} label={w.deleteDay} danger disabled={busy} onPress={() => setConfirmDelete(true)} />
      </View>
      {day.muscle_groups.length > 0 ? (
        <Text style={{ marginTop: -6, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint, textTransform: "capitalize" }}>{day.muscle_groups.join(" · ")}</Text>
      ) : null}
      {confirmDelete ? (
        <View style={[styles.confirm, { backgroundColor: color.riskSoft }]}>
          <Text style={{ fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.ink }}>{fill(w.deleteDayConfirm, { name: day.name })}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run("removeDay", { programId, dayId: day.id })} style={[styles.danger, { backgroundColor: color.risk, opacity: busy ? 0.5 : 1 }]}>
              <Text style={{ fontFamily: font.bold, fontSize: 13, color: color.bg }}>{w.deleteDay}</Text>
            </Pressable>
            <Text accessibilityRole="button" onPress={() => setConfirmDelete(false)} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{t.common.actions.cancel}</Text>
          </View>
        </View>
      ) : null}

      {day.exercises.length === 0 ? <T kind="faint">{m.noExercises}</T> : null}
      {day.exercises.map((e, i) => (
        <ExerciseRow
          key={e.id}
          programId={programId}
          dayId={day.id}
          row={e}
          first={i === 0}
          last={i === day.exercises.length - 1}
          intensity={intensity}
          unit={unit}
          run={run}
          busy={busy}
        />
      ))}

      {picking ? (
        <Picker
          dayName={day.name}
          muscles={day.muscle_groups}
          onClose={() => setPicking(false)}
          onPick={(x) => void run("addExercise", { programId, dayId: day.id, exerciseId: x.id, exerciseName: x.name })}
        />
      ) : (
        <Pressable accessibilityRole="button" onPress={() => setPicking(true)} style={[styles.add, { borderColor: color.line }]}>
          <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.accentInk }}>{m.addExercise}</Text>
        </Pressable>
      )}
    </Card>
  );
}

/** One prescribed exercise: its numbers save as each field is left, as on the web. */
function ExerciseRow({ programId, dayId, row, first, last, intensity, unit, run, busy }: {
  programId: string; dayId: string; row: BuilderExerciseV1; first: boolean; last: boolean; intensity: string; unit: WeightUnit; run: Run; busy: boolean;
}) {
  const { t } = useI18n();
  const { color } = useTheme();
  const m = t.coachWidgets.programBuilder;
  const timed = row.measure === "time";
  const shown = {
    sets: String(row.sets),
    reps: row.reps,
    rpe: row.rpe === null ? "" : String(row.rpe),
    kg: row.weight_kg === null ? "" : String(kgToDisplay(row.weight_kg, unit)),
    rest: row.rest_seconds === null ? "" : String(row.rest_seconds),
  };
  const [values, setValues] = useState(shown);
  const [notesOpen, setNotesOpen] = useState(Boolean(row.notes));
  const [notes, setNotes] = useState(row.notes ?? "");
  // A read after a save brings the stored values back; show those.
  useEffect(() => setValues(shown), [row.sets, row.reps, row.rpe, row.weight_kg, row.rest_seconds, unit]);

  function save() {
    if (JSON.stringify(values) === JSON.stringify(shown)) return;
    const kg = parseDecimal(values.kg);
    void run("updateExercise", {
      programId,
      rowId: row.id,
      sets: parseDecimal(values.sets) ?? NaN,
      reps: values.reps.trim(),
      rpe: parseDecimal(values.rpe),
      weightKg: kg === null ? null : displayToKg(kg, unit),
      restSeconds: parseDecimal(values.rest),
    });
  }

  const cell = (key: keyof typeof values, label: string, keyboard: "number-pad" | "decimal-pad" | "default") => (
    <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
      <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase", color: color.inkFaint }}>{label}</Text>
      <TextInput
        value={values[key]}
        onChangeText={(v) => setValues((x) => ({ ...x, [key]: v }))}
        onBlur={save}
        keyboardType={keyboard}
        editable={!busy}
        accessibilityLabel={`${row.exercise} ${label}`}
        style={[styles.cell, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }]}
      />
    </View>
  );

  return (
    <View style={[styles.row, { backgroundColor: color.bg }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
        <Text numberOfLines={2} style={{ flex: 1, fontFamily: font.semibold, fontSize: 14.5, color: color.ink }}>{row.exercise}</Text>
        <IconButton d={UP} label={m.moveUp} disabled={busy || first} onPress={() => void run("moveExercise", { programId, dayId, rowId: row.id, direction: -1 })} />
        <IconButton d={DOWN} label={m.moveDown} disabled={busy || last} onPress={() => void run("moveExercise", { programId, dayId, rowId: row.id, direction: 1 })} />
        <IconButton d={COPY} label={t.clientApp.routines.duplicateExercise} disabled={busy} onPress={() => void run("duplicateExercise", { programId, rowId: row.id })} />
        <IconButton d={CLOSE} label={m.removeExercise} danger disabled={busy} onPress={() => void run("removeExercise", { programId, rowId: row.id })} />
      </View>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {cell("sets", m.colSets, "number-pad")}
        {cell("reps", timed ? m.colSeconds : m.colReps, "default")}
        {cell("rpe", intensity, "decimal-pad")}
        {cell("kg", unit === "lb" ? "lb" : m.colKg, "decimal-pad")}
        {cell("rest", m.colRest, "number-pad")}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: color.inkFaint }}>{m.measure}</Text>
        {(["reps", "time"] as const).map((ms) => {
          const on = row.measure === ms;
          return (
            <Pressable key={ms} accessibilityRole="radio" accessibilityState={{ checked: on }} disabled={busy || on} onPress={() => void run("measure", { programId, rowId: row.id, measure: ms })} style={[styles.chip, { backgroundColor: on ? color.accent : color.surface }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 12, color: on ? color.accentFg : color.inkSoft }}>{ms === "time" ? m.measureTime : m.measureReps}</Text>
            </Pressable>
          );
        })}
      </View>
      {notesOpen ? (
        <View style={{ gap: 4 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase", color: color.inkFaint }}>{m.coachNote}</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            multiline
            maxLength={1000}
            editable={!busy}
            placeholder={m.coachNotePlaceholder}
            placeholderTextColor={color.inkFaint}
            onBlur={() => { if (notes.trim() !== (row.notes ?? "").trim()) void run("notes", { programId, rowId: row.id, notes }); }}
            style={[styles.notes, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }]}
          />
        </View>
      ) : (
        <Text accessibilityRole="button" onPress={() => setNotesOpen(true)} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{m.coachNoteAdd}</Text>
      )}
    </View>
  );
}

/** The library, inline under the day: search by name, a muscle chip, tap to add. */
function Picker({ dayName, muscles, onPick, onClose }: { dayName: string; muscles: string[]; onPick: (x: ExerciseHitV1) => void; onClose: () => void }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const p = t.coachWidgets.exercisePicker;
  const m = t.coachWidgets.programBuilder;
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState("");
  // The day's own muscle groups first, as the web's picker narrows to them.
  const [muscle, setMuscle] = useState(muscles[0] ?? "");
  const [extra, setExtra] = useState<ExerciseHitV1[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  useEffect(() => {
    const id = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(id);
  }, [typed]);
  useEffect(() => setExtra([]), [q, muscle]);
  const query = useQuery({ queryKey: ["exercise-search", q, muscle], queryFn: () => api.searchExercises(q, muscle) });
  const results = [...(query.data?.results ?? []), ...extra];
  const total = query.data?.total ?? 0;
  const chips = [...muscles, ...MUSCLE_GROUPS.filter((g) => !muscles.includes(g))];

  return (
    <View style={[styles.picker, { backgroundColor: color.bg, borderColor: color.line }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{fill(m.addTo, { name: dayName })}</Text>
        <Text accessibilityRole="button" onPress={onClose} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{m.closeLibrary}</Text>
      </View>
      <TextInput
        value={typed}
        onChangeText={setTyped}
        autoCorrect={false}
        placeholder={p.searchPlaceholder}
        placeholderTextColor={color.inkFaint}
        accessibilityLabel={p.searchPlaceholder}
        style={[styles.field, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }]}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6 }}>
        {["", ...chips].map((g) => {
          const on = g === muscle;
          return (
            <Pressable key={g || "all"} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setMuscle(g)} style={[styles.chip, { backgroundColor: on ? color.accent : color.surface }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 12, color: on ? color.accentFg : color.inkSoft, textTransform: g ? "capitalize" : "none" }}>{g || p.allMuscles}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>
        {query.isFetching && !query.data ? p.searching : fill(total === 1 ? p.exercisesOne : p.exercisesMany, { n: total })}
      </Text>
      {query.data && results.length === 0 ? <T kind="faint">{t.mobile.builder.noMatch}</T> : null}
      <View style={{ gap: 6 }}>
        {results.map((x) => {
          const done = added.includes(x.id);
          return (
            <Pressable
              key={x.id}
              accessibilityRole="button"
              accessibilityLabel={`${t.common.actions.add} ${x.name}`}
              onPress={() => { setAdded((a) => [...a, x.id]); onPick(x); }}
              style={[styles.hit, { backgroundColor: color.surface }]}
            >
              {x.image ? <Image source={{ uri: absolute(x.image) }} style={styles.thumb} /> : <View style={[styles.thumb, { backgroundColor: color.bg }]} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{x.name}</Text>
                <Text numberOfLines={1} style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint, textTransform: "capitalize" }}>
                  {[x.primary_muscles.join(", "), x.equipment, x.mine ? p.mine : null].filter(Boolean).join(" · ")}
                </Text>
              </View>
              <Text style={{ fontFamily: font.bold, fontSize: 13, color: done ? color.inkFaint : color.accentInk }}>{done ? "✓" : `+ ${t.common.actions.add}`}</Text>
            </Pressable>
          );
        })}
      </View>
      {results.length < total ? (
        <Pressable
          accessibilityRole="button"
          onPress={async () => {
            const next = await api.searchExercises(q, muscle, results.length).catch(() => null);
            if (next) setExtra((x) => [...x, ...next.results]);
          }}
          style={[styles.add, { borderColor: color.line }]}
        >
          <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{p.loadMore}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A day: its name and the muscle groups it trains. */
function AddDay({ programId, count, run, busy }: { programId: string; count: number; run: Run; busy: boolean }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const b = t.clientApp.builder;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  if (!open) {
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={[styles.add, { borderColor: color.line, height: 48 }]}>
        <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.accentInk }}>{`+ ${b.addDay}`}</Text>
      </Pressable>
    );
  }
  return (
    <Card style={{ gap: 12 }}>
      <Text style={{ fontFamily: font.displayBold, fontSize: 16, color: color.ink }}>{b.addDay}</Text>
      <TextInput
        autoFocus
        value={name}
        onChangeText={setName}
        maxLength={80}
        placeholder={b.dayNamePlaceholder}
        placeholderTextColor={color.inkFaint}
        accessibilityLabel={b.dayNamePlaceholder}
        style={[styles.field, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]}
      />
      <T kind="label">{b.muscleGroups}</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {MUSCLE_GROUPS.map((g) => {
          const on = groups.includes(g);
          return (
            <Pressable key={g} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setGroups((x) => (on ? x.filter((y) => y !== g) : [...x, g]))} style={[styles.chip, { backgroundColor: on ? color.accent : color.bg }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 12, color: on ? color.accentFg : color.inkSoft, textTransform: "capitalize" }}>{g}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Button
          height={42}
          label={b.addDay}
          busy={busy}
          onPress={async () => {
            const r = await run("addDay", { programId, name: name.trim() || fill(t.coachWidgets.programBuilder.dayDefaultName, { n: count + 1 }), muscleGroups: groups });
            if (r.ok) {
              setName("");
              setGroups([]);
              setOpen(false);
            }
          }}
        />
        <Text accessibilityRole="button" onPress={() => setOpen(false)} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{b.cancel}</Text>
      </View>
    </Card>
  );
}

function IconButton({ d, label, onPress, disabled, danger }: { d: string; label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  const { color } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={4} style={[styles.icon, { opacity: disabled ? 0.35 : 1 }]}>
      <NavIcon d={d} size={16} color={danger ? color.risk : color.inkSoft} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 64, gap: 14 },
  program: { minHeight: 52, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, gap: 2 },
  field: { height: 46, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, fontFamily: font.regular, fontSize: 14.5 },
  badge: { height: 24, borderRadius: 12, paddingHorizontal: 10, justifyContent: "center" },
  confirm: { borderRadius: 14, padding: 12, gap: 10 },
  danger: { height: 38, borderRadius: 14, paddingHorizontal: 14, justifyContent: "center" },
  add: { height: 42, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  row: { borderRadius: 16, padding: 12, gap: 10 },
  cell: { height: 40, borderRadius: 10, borderWidth: 1, paddingHorizontal: 6, textAlign: "center", fontFamily: font.semibold, fontSize: 14 },
  notes: { minHeight: 64, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, textAlignVertical: "top", fontFamily: font.regular, fontSize: 13.5 },
  chip: { height: 32, borderRadius: 16, paddingHorizontal: 12, justifyContent: "center" },
  picker: { borderRadius: 16, borderWidth: 1, padding: 12, gap: 10 },
  hit: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, padding: 8 },
  thumb: { width: 44, height: 44, borderRadius: 10 },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
});
