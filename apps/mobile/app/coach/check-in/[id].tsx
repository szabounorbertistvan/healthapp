import type { CheckInScoresV1 } from "@healthapp/api/v1";
import { kgToDisplay } from "@healthapp/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Screen, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { useMe } from "@/lib/role";
import { fontSize, minTouchTarget, radius, space, useTheme } from "@/lib/theme";

const SCALES = ["sleep", "energy", "stress", "hunger", "recovery"] as const;

// Reviewing one check-in: this week next to last week, the coach's own
// questions answered, the note — then feedback and "reviewed" (the web's
// reviewCheckIn, which proves through RLS that this coach coaches this client).
export default function ReviewCheckIn() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, fill, num } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const list = useOfflineQuery("coach-check-ins", ["coach-check-ins"], api.coachCheckIns);
  const unit = useMe().data?.data.weight_unit ?? "kg";
  const c = list.data?.data.find((x) => x.id === id);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review() {
    if (!c) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.reviewCheckIn(c.id, c.client_id, feedback);
      if (!result.ok) {
        setError(result.message ?? t.mobile.errors.generic);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["coach-check-ins"] });
      void queryClient.invalidateQueries({ queryKey: ["coach-dashboard"] });
      router.back();
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.food.needsSignal : t.mobile.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  const scaleRow = (key: (typeof SCALES)[number], now: CheckInScoresV1, before: CheckInScoresV1 | null) => {
    const value = now[key];
    const prev = before?.[key] ?? null;
    const delta = value !== null && prev !== null ? value - prev : null;
    return (
      <View key={key} style={styles.row}>
        <T style={{ flex: 1 }}>{t.clientWidgets.checkInForm.scales[key]}</T>
        <T kind="heading">{value ?? "—"}</T>
        <T kind="faint" style={{ width: 56, textAlign: "right" }}>
          {delta === null || delta === 0 ? "" : delta > 0 ? `+${delta}` : String(delta)}
        </T>
      </View>
    );
  };

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <BackHeader label={t.mobile.coach.inbox} />
          {!c ? (
            <T kind="soft">{list.isLoading ? "…" : t.mobile.coach.noCheckIns}</T>
          ) : (
            <>
              <T kind="title">{c.name}</T>
              <T kind="faint">{fill(t.clientApp.checkIn.weekOf, { date: c.week_start })}</T>
              <Card>
                <View style={styles.row}>
                  <T style={{ flex: 1 }}>{t.mobile.coach.weight}</T>
                  <T kind="heading">{c.weight_kg != null ? `${num(kgToDisplay(c.weight_kg, unit))} ${unit}` : "—"}</T>
                </View>
                {c.previous?.weight_kg != null ? (
                  <T kind="faint" style={{ textAlign: "right" }}>
                    {fill(t.mobile.coach.previousWeek, { value: `${num(kgToDisplay(c.previous.weight_kg, unit))} ${unit}` })}
                  </T>
                ) : null}
                {SCALES.map((key) => scaleRow(key, c.scores, c.previous))}
              </Card>
              {c.answers.length > 0 ? (
                <Card>
                  {c.answers.map((a, i) => (
                    <View key={i} style={{ gap: 2 }}>
                      <T kind="faint">{a.prompt}</T>
                      <T>{a.value || "—"}</T>
                    </View>
                  ))}
                </Card>
              ) : null}
              {c.note ? (
                <Card>
                  <T kind="soft" style={{ fontStyle: "italic" }}>{`“${c.note}”`}</T>
                </Card>
              ) : null}
              <T kind="faint">{t.mobile.coach.feedback}</T>
              <TextInput
                accessibilityLabel={t.mobile.coach.feedback}
                value={feedback}
                onChangeText={setFeedback}
                multiline
                maxLength={4000}
                style={[styles.field, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }]}
              />
              {error ? <T style={{ color: color.risk }}>{error}</T> : null}
              <Button label={t.mobile.coach.markReviewed} busy={busy} onPress={() => void review()} />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 32 },
  field: {
    minHeight: minTouchTarget * 2.5,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
    fontSize: fontSize.base,
    textAlignVertical: "top",
  },
});
