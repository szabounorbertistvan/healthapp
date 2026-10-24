import type { CheckInQuestionV1, CheckInSubmitV1 } from "@healthapp/api/v1";
import { displayToKg, kgToDisplay } from "@healthapp/shared";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Screen, T } from "@/components/ui";
import { Stepper } from "@/components/stepper";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { parseDecimal } from "@/lib/logger-model";
import { useOfflineQuery } from "@/lib/offline-query";
import { useOutbox } from "@/lib/outbox";
import { fontSize, minTouchTarget, radius, space, useTheme } from "@/lib/theme";

const SCALES = ["sleep", "energy", "stress", "hunger", "recovery"] as const;
type Scale = (typeof SCALES)[number];

// The weekly check-in — the web's /check-in: weight, the five 1–10 scales, a
// note and the coach's own questions. Sent through the outbox (submitCheckIn on
// the server), so it can be filled in with no signal; a second delivery is
// answered "already checked in", which counts as done.
export default function CheckIn() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const { session } = useAuth();
  const outbox = useOutbox();
  const query = useOfflineQuery("check-in", ["check-in"], api.checkIn);
  const data = query.data?.data;
  const [scores, setScores] = useState<Record<Scale, number>>({ sleep: 5, energy: 5, stress: 5, hunger: 5, recovery: 5 });
  const [weight, setWeight] = useState("");
  const [note, setNote] = useState("");
  const [answers, setAnswers] = useState<Record<string, number | boolean | string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const userId = session?.user.id ?? "";
  const waiting = outbox.items.find((i) => i.kind === "checkin" && i.userId === userId && !i.error);
  const refused = outbox.items.find((i) => i.kind === "checkin" && i.userId === userId && i.error);

  async function submit() {
    if (!data) return;
    const w = weight.trim() ? parseDecimal(weight) : null;
    if (w !== null && !(w > 0)) return setError(t.clientWidgets.checkInForm.couldNotSubmit);
    const input: CheckInSubmitV1 = {
      weightKg: w === null ? null : displayToKg(w, data.weight_unit),
      ...scores,
      note,
      answers: Object.entries(answers)
        .filter(([, v]) => v !== "" && !(typeof v === "number" && Number.isNaN(v)))
        .map(([questionId, value]) => ({ questionId, value })),
    };
    setBusy(true);
    setError(null);
    try {
      await outbox.queue({ kind: "checkin", input });
    } catch {
      setError(t.clientWidgets.checkInForm.couldNotSubmit);
    } finally {
      setBusy(false);
    }
  }

  const field = [styles.field, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }];

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <BackHeader label={t.mobile.tabs.progress} />
          <T kind="title">{t.clientApp.checkIn.title}</T>
          {!data ? (
            query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} />
          ) : (
            <>
              <T kind="faint">{fill(t.clientApp.checkIn.weekOf, { date: data.week_start })}</T>
              {refused ? (
                <Card style={{ borderColor: color.risk }}>
                  <T style={{ color: color.risk }}>{`${t.clientWidgets.checkInForm.couldNotSubmit}: ${refused.error}`}</T>
                  <Button kind="quiet" label={t.clientWidgets.setLogger.dismiss} onPress={() => void outbox.dismissRefused()} />
                </Card>
              ) : null}
              {data.submitted ? (
                <Card>
                  <T kind="heading">{t.clientApp.checkIn.submittedTitle}</T>
                  <T kind="soft">{t.clientApp.checkIn.submittedBody}</T>
                </Card>
              ) : waiting ? (
                <Card>
                  <T kind="heading">{t.clientApp.checkIn.submittedTitle}</T>
                  <T kind="soft">{t.mobile.checkIn.queued}</T>
                </Card>
              ) : (
                <Card>
                  <T kind="faint">{fill(t.clientWidgets.checkInForm.weightKg, { unit: data.weight_unit })}</T>
                  <TextInput
                    accessibilityLabel={fill(t.clientWidgets.checkInForm.weightKg, { unit: data.weight_unit })}
                    placeholder={t.clientWidgets.checkInForm.optional}
                    placeholderTextColor={color.inkFaint}
                    value={weight}
                    onChangeText={setWeight}
                    keyboardType="decimal-pad"
                    style={field}
                  />
                  <T kind="faint">{t.mobile.checkIn.scaleHint}</T>
                  {SCALES.map((s) => (
                    <View key={s} style={styles.row}>
                      <T style={{ flex: 1 }}>{t.clientWidgets.checkInForm.scales[s]}</T>
                      <Stepper value={scores[s]} label={t.clientWidgets.checkInForm.scales[s]} onChange={(v) => setScores((p) => ({ ...p, [s]: v }))} />
                    </View>
                  ))}
                  {data.questions.length > 0 ? <T kind="heading">{t.clientWidgets.checkInForm.coachQuestions}</T> : null}
                  {data.questions.map((q) => (
                    <Question key={q.id} q={q} value={answers[q.id]} onChange={(v) => setAnswers((p) => ({ ...p, [q.id]: v }))} />
                  ))}
                  <T kind="faint">{t.mobile.checkIn.note}</T>
                  <TextInput
                    accessibilityLabel={t.mobile.checkIn.note}
                    placeholder={t.clientWidgets.checkInForm.coachNote}
                    placeholderTextColor={color.inkFaint}
                    value={note}
                    onChangeText={setNote}
                    multiline
                    maxLength={2000}
                    style={[field, { minHeight: 96, textAlignVertical: "top", paddingTop: space.md }]}
                  />
                  {error ? <T style={{ color: color.risk }}>{error}</T> : null}
                  <Button label={t.clientWidgets.checkInForm.submit} busy={busy} onPress={() => void submit()} />
                </Card>
              )}

              {data.last ? (
                <Card>
                  <T kind="faint">{fill(t.clientApp.checkIn.lastCheckIn, { date: data.last.week_start })}</T>
                  {data.last.weight_kg != null ? (
                    <T>{`${t.clientApp.checkIn.weightLabel}: ${kgToDisplay(data.last.weight_kg, data.weight_unit)} ${data.weight_unit}`}</T>
                  ) : null}
                  {data.last.note ? <T kind="soft">{data.last.note}</T> : null}
                  {data.last.coach_feedback ? (
                    <>
                      <T kind="heading">{t.clientApp.checkIn.coachFeedback}</T>
                      <T>{data.last.coach_feedback}</T>
                    </>
                  ) : data.has_coach ? (
                    <T kind="faint">{data.last.reviewed ? t.clientApp.checkIn.reviewed : t.clientApp.checkIn.waitingReview}</T>
                  ) : null}
                </Card>
              ) : null}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function Question({ q, value, onChange }: { q: CheckInQuestionV1; value: number | boolean | string | undefined; onChange: (v: number | boolean | string) => void }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const field = [styles.field, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }];
  return (
    <View style={{ gap: 4 }}>
      <T>{q.prompt}</T>
      {q.kind === "scale" ? (
        <Stepper value={typeof value === "number" ? value : 5} label={q.prompt} onChange={onChange} />
      ) : q.kind === "number" ? (
        <TextInput
          accessibilityLabel={q.prompt}
          keyboardType="decimal-pad"
          value={typeof value === "number" && !Number.isNaN(value) ? String(value) : ""}
          onChangeText={(text) => onChange(text.trim() ? parseDecimal(text) : "")}
          style={field}
        />
      ) : q.kind === "yes_no" ? (
        <View style={styles.row}>
          {[true, false].map((v) => (
            <Pressable
              key={String(v)}
              accessibilityRole="button"
              accessibilityState={{ selected: value === v }}
              onPress={() => onChange(v)}
              style={[styles.choice, { borderColor: value === v ? color.accent : color.line, backgroundColor: value === v ? color.accentSoft : "transparent" }]}
            >
              <T style={{ fontWeight: "700" }}>{v ? t.clientWidgets.checkInForm.yes : t.clientWidgets.checkInForm.no}</T>
            </Pressable>
          ))}
        </View>
      ) : (
        <TextInput accessibilityLabel={q.prompt} value={typeof value === "string" ? value : ""} onChangeText={onChange} maxLength={1000} style={field} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  field: { minHeight: minTouchTarget + 4, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: space.md, fontSize: fontSize.base },
  choice: { flex: 1, minHeight: minTouchTarget, borderWidth: 1, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
});
