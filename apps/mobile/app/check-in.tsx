import type { CheckInQuestionV1, CheckInSubmitV1 } from "@healthapp/api/v1";
import { displayToKg, kgToDisplay } from "@healthapp/shared";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, NavIcon, Slider, T } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { parseDecimal } from "@/lib/logger-model";
import { useOfflineQuery } from "@/lib/offline-query";
import { useOutbox } from "@/lib/outbox";
import { alpha, font, useTheme } from "@/lib/theme";

const SCALES = ["sleep", "energy", "stress", "hunger", "recovery"] as const;
type Scale = (typeof SCALES)[number];
type Answer = number | boolean | string;

// The weekly check-in — the web's /check-in on a phone (app/(client)/check-in/
// page.tsx + components/check-in-form.tsx): weight, the five 1–10 scales, the
// coach's own questions and a note, then last week's answers with the coach's
// reply. Sent through the outbox (submitCheckIn on the server), so it can be
// filled in with no signal; a second delivery is answered "already checked
// in", which counts as done.
export default function CheckIn() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const { session } = useAuth();
  const outbox = useOutbox();
  const query = useOfflineQuery("check-in", ["check-in"], api.checkIn);
  const data = query.data?.data;
  const c = t.clientApp.checkIn;
  const m = t.clientWidgets.checkInForm;
  const [scores, setScores] = useState<Record<Scale, number>>({ sleep: 5, energy: 5, stress: 5, hunger: 5, recovery: 5 });
  const [weight, setWeight] = useState("");
  const [note, setNote] = useState("");
  // the coach's own questions: unanswered ones are simply not sent
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const userId = session?.user.id ?? "";
  const waiting = outbox.items.find((i) => i.kind === "checkin" && i.userId === userId && !i.error);
  const refused = outbox.items.find((i) => i.kind === "checkin" && i.userId === userId && i.error);

  async function submit() {
    if (!data) return;
    const w = weight.trim() ? parseDecimal(weight) : null;
    if (w !== null && !(w > 0)) return setError(m.couldNotSubmit);
    const input: CheckInSubmitV1 = {
      weightKg: w === null ? null : displayToKg(w, data.weight_unit),
      ...scores,
      note,
      answers: Object.entries(answers).map(([questionId, value]) => ({ questionId, value })),
    };
    setBusy(true);
    setError(null);
    try {
      await outbox.queue({ kind: "checkin", input });
    } catch {
      setError(m.couldNotSubmit);
    } finally {
      setBusy(false);
    }
  }

  const sent = (title: string, body: string) => (
    <Card style={{ gap: 0 }}>
      <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{title}</Text>
      <Text style={[styles.prose(color.inkSoft), { marginTop: 6 }]}>{body}</Text>
    </Card>
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Pressable
          accessibilityRole="link"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 4 }}
        >
          <NavIcon d="m15 6-6 6 6 6" size={14} color={color.inkFaint} />
          <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkFaint }}>{t.common.nav.today}</Text>
        </Pressable>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
          <T kind="title">{c.title}</T>
          {data ? <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{fill(c.weekOf, { date: data.week_start })}</Text> : null}
        </View>
        {query.data?.fromPhone ? <T kind="faint">{t.mobile.workout.fromPhone}</T> : null}

        {!data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : (
          <>
            {refused ? (
              <View style={{ borderRadius: 20, backgroundColor: color.riskSoft, padding: 16, gap: 8 }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.risk }}>{`${m.couldNotSubmit}: ${refused.error}`}</Text>
                <Pressable accessibilityRole="button" onPress={() => void outbox.dismissRefused()} style={{ alignSelf: "flex-start" }}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{t.clientWidgets.setLogger.dismiss}</Text>
                </Pressable>
              </View>
            ) : null}

            {data.submitted ? (
              sent(c.submittedTitle, c.submittedBody)
            ) : waiting ? (
              sent(c.submittedTitle, t.mobile.checkIn.queued)
            ) : (
              <Card style={{ gap: 20 }}>
                <View>
                  <Text style={styles.label(color.inkFaint, 11)}>{fill(m.weightKg, { unit: data.weight_unit })}</Text>
                  <TextInput
                    accessibilityLabel={fill(m.weightKg, { unit: data.weight_unit })}
                    placeholder={m.optional}
                    placeholderTextColor={color.inkFaint}
                    value={weight}
                    onChangeText={setWeight}
                    keyboardType="decimal-pad"
                    style={[styles.input, { marginTop: 6, width: 144, color: color.ink, backgroundColor: color.bg, borderColor: color.line }]}
                  />
                </View>

                {/* The five scales, each a label + its value + the slider under them. */}
                <View style={[styles.panel, { backgroundColor: color.bg }]}>
                  {SCALES.map((s, i) => (
                    <View key={s} style={[{ paddingVertical: 10 }, i === 0 ? { paddingTop: 0 } : { borderTopWidth: 1, borderTopColor: alpha(color.line, 0.6) }, i === SCALES.length - 1 ? { paddingBottom: 0 } : null]}>
                      <View style={styles.between}>
                        <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{m.scales[s]}</Text>
                        <Text style={{ fontFamily: font.displayBold, fontSize: 16, color: color.accentInk }}>{scores[s]}</Text>
                      </View>
                      <Slider value={scores[s]} label={m.scales[s]} onChange={(v) => setScores((p) => ({ ...p, [s]: v }))} />
                    </View>
                  ))}
                </View>

                {data.questions.length > 0 ? (
                  <View style={[styles.panel, { backgroundColor: color.bg }]}>
                    <Text style={styles.label(color.inkFaint, 11)}>{m.coachQuestions}</Text>
                    <View style={{ marginTop: 4 }}>
                      {data.questions.map((q, i) => (
                        <View key={q.id} style={i > 0 ? { borderTopWidth: 1, borderTopColor: alpha(color.line, 0.6) } : null}>
                          <Question
                            q={q}
                            value={answers[q.id]}
                            onChange={(v) =>
                              setAnswers((prev) => {
                                const next = { ...prev };
                                if (v === null) delete next[q.id];
                                else next[q.id] = v;
                                return next;
                              })
                            }
                          />
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}

                <View>
                  <Text style={styles.label(color.inkFaint, 11)}>{m.coachNote}</Text>
                  <TextInput
                    accessibilityLabel={m.coachNote}
                    value={note}
                    onChangeText={setNote}
                    multiline
                    maxLength={2000}
                    style={[styles.input, { marginTop: 6, height: 84, paddingTop: 10, textAlignVertical: "top", color: color.ink, backgroundColor: color.bg, borderColor: color.line }]}
                  />
                </View>

                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void submit()}
                  style={[styles.goldButton, { backgroundColor: color.accent, opacity: busy ? 0.4 : 1 }]}
                >
                  {busy ? <ActivityIndicator color={color.accentFg} /> : <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.accentFg }}>{m.submit}</Text>}
                </Pressable>
                {error ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.risk }}>{error}</Text> : null}
              </Card>
            )}

            {data.last ? (
              <>
                <Card style={{ gap: 0 }}>
                  <Text style={styles.label(color.inkFaint, 11)}>{fill(c.lastCheckIn, { date: data.last.week_start })}</Text>
                  {data.last.weight_kg != null ? (
                    <Text style={{ marginTop: 8, fontFamily: font.regular, fontSize: 14, color: color.inkSoft }}>
                      {`${c.weightLabel} `}
                      <Text style={{ fontFamily: font.semibold, color: color.ink }}>{`${kgToDisplay(data.last.weight_kg, data.weight_unit)} ${data.weight_unit}`}</Text>
                    </Text>
                  ) : null}
                  {data.last.note ? <Text style={[styles.prose(color.inkSoft), { marginTop: 8, fontStyle: "italic" }]}>{data.last.note}</Text> : null}
                  {data.last.coach_feedback ? null : (
                    <Text style={{ marginTop: 12, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
                      {data.last.reviewed ? c.reviewed : c.waitingReview}
                    </Text>
                  )}
                </Card>
                {data.last.coach_feedback ? (
                  <View style={{ borderRadius: 24, backgroundColor: color.accentSoft, paddingHorizontal: 20, paddingVertical: 18 }}>
                    <Text style={styles.label(color.accentInk, 11)}>{c.coachFeedback}</Text>
                    <Text style={[styles.prose(color.inkSoft), { marginTop: 6 }]}>{data.last.coach_feedback}</Text>
                  </View>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** One coach question, answered the way its kind asks (check-in-form.tsx QuestionField). */
function Question({ q, value, onChange }: { q: CheckInQuestionV1; value: Answer | undefined; onChange: (v: Answer | null) => void }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const m = t.clientWidgets.checkInForm;
  const input = { color: color.ink, backgroundColor: color.surface, borderColor: color.line };
  return (
    <View style={{ paddingVertical: 10 }}>
      <View style={styles.between}>
        <Text style={{ flexShrink: 1, fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{q.prompt}</Text>
        {q.kind === "scale" ? (
          <Text style={{ fontFamily: font.displayBold, fontSize: 16, color: color.accentInk }}>{typeof value === "number" ? value : "—"}</Text>
        ) : null}
      </View>
      {q.kind === "scale" ? (
        <Slider value={typeof value === "number" ? value : 5} label={q.prompt} onChange={onChange} />
      ) : q.kind === "number" ? (
        <TextInput
          accessibilityLabel={q.prompt}
          keyboardType="decimal-pad"
          placeholder={m.optional}
          placeholderTextColor={color.inkFaint}
          defaultValue={typeof value === "number" ? String(value) : ""}
          onChangeText={(text) => {
            const n = parseDecimal(text);
            onChange(text.trim() === "" || Number.isNaN(n) ? null : n);
          }}
          style={[styles.input, { marginTop: 6, width: 144, height: 40 }, input]}
        />
      ) : q.kind === "yes_no" ? (
        <View accessibilityRole="radiogroup" style={{ marginTop: 6, flexDirection: "row", gap: 6 }}>
          {[true, false].map((b) => (
            <Pressable
              key={String(b)}
              accessibilityRole="radio"
              accessibilityState={{ checked: value === b }}
              onPress={() => onChange(value === b ? null : b)}
              style={[
                styles.choice,
                value === b ? { backgroundColor: color.accent } : { backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
              ]}
            >
              <Text style={{ fontFamily: font.semibold, fontSize: 13, color: value === b ? color.accentFg : color.inkSoft }}>{b ? m.yes : m.no}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <TextInput
          accessibilityLabel={q.prompt}
          multiline
          maxLength={1000}
          value={typeof value === "string" ? value : ""}
          onChangeText={(text) => onChange(text.trim() ? text : null)}
          style={[styles.input, { marginTop: 6, height: 64, paddingTop: 8, textAlignVertical: "top" }, input]}
        />
      )}
    </View>
  );
}

const styles = {
  ...StyleSheet.create({
    body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 16 },
    between: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
    panel: { borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14 },
    input: { height: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontFamily: font.regular, fontSize: 14 },
    choice: { height: 36, borderRadius: 18, paddingHorizontal: 16, justifyContent: "center" },
    goldButton: { height: 44, borderRadius: 16, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  }),
  label: (ink: string, size = 10) => ({ fontFamily: font.semibold, fontSize: size, letterSpacing: 0.6, textTransform: "uppercase" as const, color: ink }),
  prose: (ink: string) => ({ fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: ink }),
};
