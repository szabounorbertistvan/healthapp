import type { WorkoutDayV1, WorkoutExerciseV1 } from "@healthapp/api/v1";
import { displayToKg, kgToDisplay, MAX_SET_REPS, MAX_SET_SECONDS, MAX_SET_WEIGHT_KG, validateSetEdit } from "@healthapp/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { Stepper } from "@/components/stepper";
import { Button, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { parseDecimal, type DisplaySet } from "@/lib/logger-model";
import { fontSize, minTouchTarget, radius, space, useTheme } from "@/lib/theme";

/**
 * Fix a set already on record — POST /api/v1/sets/update, the web's
 * updateLoggedSet() (same checks, PR flags recomputed over the lift's history).
 * Online only, and only for a set the server has: a set still in the outbox
 * has no id yet.
 */
export function EditSet({
  set,
  exercise,
  day,
  onClose,
}: {
  set: DisplaySet;
  exercise: WorkoutExerciseV1;
  day: WorkoutDayV1;
  onClose: () => void;
}) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const unit = day.weight_unit;
  const timed = exercise.measure === "time";
  const [weight, setWeight] = useState(String(kgToDisplay(set.weight_kg, unit)));
  const [reps, setReps] = useState(String(timed ? set.duration_seconds ?? "" : set.reps));
  const [rir, setRir] = useState(set.rir != null ? String(set.rir) : "");
  const [rpe, setRpe] = useState(set.rpe ?? 8);
  const [note, setNote] = useState(set.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!set.id) return setError(t.mobile.editSet.onlySynced);
    const shown = weight.trim() === "" ? 0 : parseDecimal(weight);
    const weightKg = Number.isNaN(shown) ? Number.NaN : displayToKg(shown, unit);
    const amount = Number(reps.trim());
    const rirValue = day.intensity_mode === "rir" && rir.trim() ? parseDecimal(rir) : null;
    const edit = {
      weight_kg: weightKg,
      reps: timed ? 0 : amount,
      duration_seconds: timed ? amount : null,
      rpe,
      rir: rirValue,
      notes: note.trim() || null,
    };
    const invalid = validateSetEdit(edit);
    if (invalid) {
      const m = t.clientWidgets.setLogger;
      return setError(
        invalid === "weight" ? fill(m.errWeight, { max: kgToDisplay(MAX_SET_WEIGHT_KG, unit), unit })
        : invalid === "reps" ? fill(m.errReps, { max: MAX_SET_REPS })
        : invalid === "duration" ? fill(m.errDuration, { max: MAX_SET_SECONDS })
        : invalid === "rpe" ? m.errRpe : m.errRir,
      );
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.updateSet({
        setId: set.id,
        dayId: day.day_id,
        weightKg: edit.weight_kg,
        reps: edit.reps,
        rpe: edit.rpe,
        rir: edit.rir,
        notes: edit.notes,
        durationSeconds: edit.duration_seconds,
      });
      if (!result.ok) {
        setError(result.message ?? t.clientWidgets.setLogger.couldNotEdit);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["workout", day.day_id] });
      onClose();
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.editSet.needsSignal : t.clientWidgets.setLogger.couldNotEdit);
    } finally {
      setBusy(false);
    }
  }

  const field = [styles.field, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }];
  const repsLabel = timed ? t.clientWidgets.setLogger.seconds : t.clientWidgets.setLogger.reps;
  return (
    <View style={[styles.box, { borderColor: color.accent }]}>
      <T kind="heading">{fill(t.mobile.editSet.title, { n: set.set_index })}</T>
      <View style={styles.row}>
        <View style={{ flex: 1, gap: 4 }}>
          <T kind="faint">{unit}</T>
          <TextInput accessibilityLabel={t.clientWidgets.setLogger.kg} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" style={field} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <T kind="faint">{repsLabel}</T>
          <TextInput accessibilityLabel={repsLabel} value={reps} onChangeText={setReps} keyboardType="number-pad" style={field} />
        </View>
        {day.intensity_mode === "rir" ? (
          <View style={{ flex: 1, gap: 4 }}>
            <T kind="faint">{t.clientWidgets.setLogger.rir}</T>
            <TextInput accessibilityLabel={t.clientWidgets.setLogger.rir} value={rir} onChangeText={setRir} keyboardType="number-pad" style={field} />
          </View>
        ) : null}
      </View>
      <View style={styles.row}>
        <T kind="faint" style={{ flex: 1 }}>{t.mobile.workout.intensity}</T>
        <Stepper value={rpe} onChange={setRpe} label={t.clientWidgets.setLogger.intensity} format={(v) => `${v}/10`} />
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
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Button label={t.mobile.editSet.save} busy={busy} onPress={() => void save()} />
        </View>
        <View style={{ flex: 1 }}>
          <Button kind="quiet" label={t.mobile.editSet.cancel} onPress={onClose} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  field: {
    minHeight: minTouchTarget + 4,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    fontSize: fontSize.lg,
    textAlign: "center",
  },
});
