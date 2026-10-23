import { cmToDisplay, displayToCm, displayToKg, kgToDisplay } from "@healthapp/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Screen, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { parseDecimal } from "@/lib/logger-model";
import { useOfflineQuery } from "@/lib/offline-query";
import { fontSize, minTouchTarget, radius, space, useTheme } from "@/lib/theme";

// Progress: a weigh-in (and waist), the recent measurements with the change
// since the oldest shown, the best lifts, and the way to the weekly check-in.
// The charts, photos and goals stay on the web for now.
export default function Progress() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const query = useOfflineQuery("progress", ["progress"], api.progress);
  const data = query.data?.data;
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    if (!data) return;
    const w = weight.trim() ? parseDecimal(weight) : null;
    const c = waist.trim() ? parseDecimal(waist) : null;
    if ((w !== null && !(w > 0)) || (c !== null && !(c > 0)) || (w === null && c === null)) {
      return setNote({ ok: false, text: t.clientWidgets.measurementForm.couldNotSave });
    }
    setBusy(true);
    setNote(null);
    try {
      const result = await api.addMeasurement({
        weightKg: w === null ? null : displayToKg(w, data.weight_unit),
        waistCm: c === null ? null : displayToCm(c, data.length_unit),
      });
      if (!result.ok) setNote({ ok: false, text: result.message ?? t.clientWidgets.measurementForm.couldNotSave });
      else {
        setNote({ ok: true, text: t.mobile.progress.saved });
        setWeight("");
        setWaist("");
        await queryClient.invalidateQueries({ queryKey: ["progress"] });
      }
    } catch (error) {
      setNote({ ok: false, text: error instanceof ApiFailure && error.kind === "offline" ? t.mobile.food.needsSignal : t.clientWidgets.measurementForm.couldNotSave });
    } finally {
      setBusy(false);
    }
  }

  const weighIns = (data?.measurements ?? []).filter((m) => m.weight_kg != null);
  const newest = weighIns[0];
  const oldest = weighIns[weighIns.length - 1];
  const field = [styles.field, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }];

  return (
    <Screen>
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
        >
          <T kind="title">{t.mobile.tabs.progress}</T>
          {query.data?.fromPhone ? <T kind="faint">{t.mobile.workout.fromPhone}</T> : null}

          <Pressable accessibilityRole="button" onPress={() => router.push("/check-in")}>
            <Card>
              <View style={styles.row}>
                <T kind="heading" style={{ flex: 1 }}>{t.mobile.progress.checkIn}</T>
                <T kind="accent">{`${t.mobile.progress.open} ›`}</T>
              </View>
            </Card>
          </Pressable>

          {!data ? (
            query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} />
          ) : (
            <>
              <Card>
                <T kind="heading">{t.mobile.progress.weighIn}</T>
                <View style={styles.row}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <T kind="faint">{fill(t.mobile.progress.weight, { unit: data.weight_unit })}</T>
                    <TextInput accessibilityLabel={fill(t.mobile.progress.weight, { unit: data.weight_unit })} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" style={field} />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <T kind="faint">{fill(t.mobile.progress.waist, { unit: data.length_unit })}</T>
                    <TextInput accessibilityLabel={fill(t.mobile.progress.waist, { unit: data.length_unit })} value={waist} onChangeText={setWaist} keyboardType="decimal-pad" style={field} />
                  </View>
                </View>
                {note ? <T style={{ color: note.ok ? color.accentInk : color.risk }}>{note.text}</T> : null}
                <Button label={t.mobile.progress.save} busy={busy} onPress={() => void save()} />
              </Card>

              <Card>
                {newest && oldest && newest !== oldest ? (
                  <T kind="heading">
                    {fill(t.mobile.progress.change, {
                      value: signed(kgToDisplay(newest.weight_kg! - oldest.weight_kg!, data.weight_unit)),
                      unit: data.weight_unit,
                      date: oldest.taken_on,
                    })}
                  </T>
                ) : null}
                {data.measurements.length === 0 ? <T kind="soft">{t.mobile.progress.nothingYet}</T> : null}
                {data.measurements.slice(0, 12).map((m) => (
                  <View key={m.taken_on} style={styles.row}>
                    <T kind="faint" style={{ width: 96 }}>{m.taken_on}</T>
                    <T style={{ flex: 1 }}>{m.weight_kg != null ? `${kgToDisplay(m.weight_kg, data.weight_unit)} ${data.weight_unit}` : "—"}</T>
                    <T kind="soft">{m.waist_cm != null ? `${cmToDisplay(m.waist_cm, data.length_unit)} ${data.length_unit}` : ""}</T>
                  </View>
                ))}
              </Card>

              <Card>
                <T kind="heading">{t.mobile.progress.records}</T>
                {data.prs.length === 0 ? <T kind="soft">{t.mobile.progress.noRecords}</T> : null}
                {data.prs.slice(0, 10).map((p) => (
                  <View key={`${p.exercise}:${p.at}`} style={styles.row}>
                    <T style={{ flex: 1 }}>{p.exercise}</T>
                    <T kind="soft">{fill(t.mobile.progress.e1rm, { value: kgToDisplay(p.best_kg, data.weight_unit), unit: data.weight_unit })}</T>
                  </View>
                ))}
              </Card>
            </>
          )}
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`${config.webUrl}/progress`)}>
            <T kind="accent" style={{ textAlign: "center" }}>{t.mobile.progress.moreOnWeb}</T>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function signed(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r > 0 ? `+${r}` : String(r);
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 32 },
  field: { minHeight: minTouchTarget + 4, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: space.md, fontSize: fontSize.lg, textAlign: "center" },
});
