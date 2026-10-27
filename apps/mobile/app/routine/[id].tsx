import { circuitLabel, copyName } from "@healthapp/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { routineTags, SaveButton } from "@/components/routine-card";
import { AssignRoutine, RoutineDetailsForm, RoutineStatus, ShareRoutine } from "@/components/routine-extras";
import { Button, Card, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// One routine — the web's /routines/[id] on a phone: what it is and who wrote
// it, the facts and tags, Save, Copy to my programs (or Duplicate your own),
// Edit in the builder for your own, then every day and every prescribed set.
// Assigning to a client and the publish settings stay on the web.

export default function RoutineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const r = t.clientApp.routines;
  const query = useQuery({ queryKey: ["routines", "detail", id], queryFn: () => api.routine(id) });
  const data = query.data;
  const [copying, setCopying] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.copyRoutine(id, name);
      if (!res.ok) return setError(res.message ?? r.couldNotCopy);
      setCopying(false);
      setNote(res.message ?? null);
      void queryClient.invalidateQueries({ queryKey: ["routines"] });
      void queryClient.invalidateQueries({ queryKey: ["builder"] });
      if (res.id) router.replace({ pathname: "/routine/[id]", params: { id: res.id } });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : r.couldNotCopy);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={r.title} />
        {!data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : (
          <>
            {(() => {
              const { card } = data;
              const facts = [
                card.days_per_week === 1 ? r.perWeekOne : card.days_per_week > 0 ? fill(r.perWeek, { count: card.days_per_week }) : fill(r.daysCount, { count: card.days }),
                card.weeks > 1 ? fill(r.weeksCount, { count: card.weeks }) : r.oneWeek,
                fill(r.exercisesCount, { count: card.exercises }),
                card.total_sets > 0 ? fill(r.setsCount, { count: card.total_sets }) : null,
                data.session_minutes > 0 ? fill(r.sessionAbout, { count: data.session_minutes }) : null,
              ].filter((x): x is string => Boolean(x));
              const tags = [...routineTags(card, r), card.visibility !== "private" ? r.visibility[card.visibility] : null].filter((x): x is string => Boolean(x));
              return (
                <View style={{ gap: 10 }}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T kind="title">{card.name}</T>
                      <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{fill(r.by, { author: card.author_name })}</Text>
                    </View>
                    <SaveButton card={card} withLabel />
                  </View>
                  {card.assigned_by_coach ? (
                    <View style={[styles.tag, { alignSelf: "flex-start", backgroundColor: color.accentSoft }]}>
                      <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.accentInk }}>{`✓ ${r.assignedByCoach}`}</Text>
                    </View>
                  ) : null}
                  {card.description ? <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{card.description}</Text> : null}
                  <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{facts.join(" · ")}</Text>
                  {card.muscle_groups.length > 0 ? <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint, textTransform: "capitalize" }}>{card.muscle_groups.join(" · ")}</Text> : null}
                  {card.equipment.length > 0 ? <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{`${r.equipmentLabel}: ${card.equipment.join(" · ")}`}</Text> : null}
                  {tags.length > 0 ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {tags.map((tag) => (
                        <View key={tag} style={[styles.tag, { backgroundColor: color.surface }]}>
                          <Text style={{ fontFamily: font.semibold, fontSize: 11, color: color.inkSoft }}>{tag}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  <View style={{ marginTop: 6, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {card.is_mine && card.days > 0 ? <Button height={44} label={r.start} onPress={() => router.navigate("/workout")} /> : null}
                    {data.may_edit ? (
                      <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: "/build", params: { program: card.id } })} style={[styles.quiet, { backgroundColor: color.surface }]}>
                        <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{t.clientApp.workout.editProgram}</Text>
                      </Pressable>
                    ) : null}
                    {data.clients && data.clients.length > 0 ? (
                      <Pressable accessibilityRole="button" onPress={() => { setCopying(false); setNote(null); setAssigning(true); }} style={[styles.quiet, { backgroundColor: color.surface }]}>
                        <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{r.assign}</Text>
                      </Pressable>
                    ) : null}
                    {data.may_share ? <ShareRoutine id={card.id} /> : null}
                    {data.may_copy ? (
                      <Pressable accessibilityRole="button" onPress={() => { setName(copyName(card.name)); setError(null); setAssigning(false); setCopying(true); }} style={[styles.quiet, { backgroundColor: color.surface }]}>
                        <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{card.is_mine ? r.duplicate : r.copy}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {!data.may_copy && !card.is_mine ? <T kind="faint">{r.cannotCopyCoached}</T> : null}
                  {note ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{note}</Text> : null}
                  {error ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
                  {assigning && data.clients ? (
                    <AssignRoutine card={card} clients={data.clients} onDone={(msg) => { setAssigning(false); setNote(msg); }} />
                  ) : null}
                  {data.may_edit_details ? <RoutineDetailsForm key={`${card.name}:${card.visibility}:${card.weeks}`} card={card} canPublish={data.may_publish ?? false} /> : null}
                  <RoutineStatus data={data} />
                  {copying ? (
                    <Card style={{ gap: 10 }}>
                      <T kind="label">{r.nameLabel}</T>
                      <TextInput
                        autoFocus
                        value={name}
                        onChangeText={setName}
                        maxLength={120}
                        placeholder={r.namePlaceholder}
                        placeholderTextColor={color.inkFaint}
                        accessibilityLabel={r.nameLabel}
                        style={[styles.input, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]}
                      />
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                        <Button height={40} label={r.confirmCopy} busy={busy} disabled={name.trim().length < 2} onPress={() => void copy()} />
                        <Text accessibilityRole="button" onPress={() => setCopying(false)} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{r.cancel}</Text>
                      </View>
                    </Card>
                  ) : null}
                </View>
              );
            })()}

            <Text style={{ marginTop: 8, fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{r.structure}</Text>
            {data.days.length === 0 ? <T kind="faint">{r.noDays}</T> : null}
            {data.days.map((day, index) => (
              <Card key={day.id} style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T kind="label">{fill(r.dayN, { n: index + 1 })}</T>
                    <Text numberOfLines={1} style={{ marginTop: 2, fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{day.name}</Text>
                  </View>
                  <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{fill(r.aboutMinutes, { count: day.minutes })}</Text>
                </View>
                {day.exercises.length === 0 ? <T kind="faint">—</T> : null}
                {day.exercises.map((e, i) => {
                  const startsCircuit = e.circuit !== null && day.exercises[i - 1]?.circuit !== e.circuit;
                  const intensity = e.rpe !== null && data.intensity_mode !== "simple"
                    ? ` · ${data.intensity_mode === "rir" ? t.clientWidgets.setLogger.rir : t.clientWidgets.setLogger.rpe} ${e.rpe}`
                    : "";
                  const sub = [
                    e.set_type !== "normal" && e.set_type in r.setType ? r.setType[e.set_type as keyof typeof r.setType] : null,
                    e.weight_kg !== null ? fill(r.targetKg, { value: e.weight_kg }) : null,
                    e.rest_seconds !== null ? fill(r.restSeconds, { count: e.rest_seconds }) : null,
                    e.equipment,
                  ].filter(Boolean).join(" · ");
                  return (
                    <View key={e.id} style={e.circuit !== null ? [styles.circuit, { borderLeftColor: color.accent, backgroundColor: color.accentSoft }] : null}>
                      {startsCircuit ? (
                        <Text style={{ marginBottom: 4, fontFamily: font.semibold, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: color.accentInk }}>
                          {fill(r.circuitLabel, { letter: circuitLabel(e.circuit!) })}
                        </Text>
                      ) : null}
                      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                        <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.regular, fontSize: 13.5, color: color.ink }}>{e.name}</Text>
                        <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkSoft }}>{`${e.sets} × ${e.reps}${e.measure === "time" ? " s" : ""}${intensity}`}</Text>
                      </View>
                      {sub ? <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{sub}</Text> : null}
                    </View>
                  );
                })}
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  tag: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  quiet: { height: 44, borderRadius: 16, paddingHorizontal: 16, justifyContent: "center" },
  input: { height: 46, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, fontFamily: font.regular, fontSize: 14.5 },
  circuit: { borderLeftWidth: 3, borderRadius: 10, paddingVertical: 6, paddingLeft: 10 },
});
