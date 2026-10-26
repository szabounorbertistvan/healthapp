import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DayCard, LoadBadge, Pill } from "@/components/training";
import { Button, Card, Divider, T } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { font, useTheme } from "@/lib/theme";
import { router } from "expo-router";

// Training — the web's /workout on a phone (app/(client)/workout/page.tsx):
// the page actions, every published program with its day cards, then the
// history. Building and editing your own program is app/build.tsx.


export default function Workout() {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const query = useOfflineQuery("workouts", ["workouts"], api.workouts);
  const data = query.data?.data;
  const w = t.clientApp.workout;
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");
  const programs = data?.programs ?? [];
  const hasOwn = programs.some((g) => g.is_own);
  const sessions = data?.sessions ?? [];

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <T kind="title">{t.common.nav.training}</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: -4 }}>
          <Pill icon="M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 0-2 2zM4 4v18M8 8h6" label={t.clientApp.library.title} onPress={() => router.push("/exercises")} />
          <Pill icon="M12 4v11M7 10l5 5 5-5M5 20h14" label={t.clientApp.workoutImport.link} onPress={() => router.push("/workout-import")} />
          {data && programs.length > 0 && !data.has_coach ? (
            <Pill
              icon={hasOwn ? "M4 20h4l10-10-4-4L4 16zM13 7l4 4" : "M12 5v14M5 12h14"}
              label={hasOwn ? w.editProgram : t.clientApp.builder.title}
              onPress={() => router.push("/build")}
            />
          ) : null}
        </View>
        {query.data?.fromPhone ? <T kind="faint">{t.mobile.workout.fromPhone}</T> : null}

        {!data ? (
          query.isError ? (
            <T kind="soft">{t.mobile.errors.offline}</T>
          ) : (
            <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
          )
        ) : (
          <>
            {programs.length === 0 ? (
              <View style={{ gap: 12 }}>
                <View style={{ paddingVertical: 8 }}>
                  <T kind="heading">{w.noProgramTitle}</T>
                  <T kind="faint" style={{ marginTop: 4, lineHeight: 18 }}>{data.has_coach ? w.noProgramHint : w.noProgramHintSolo}</T>
                </View>
                <View style={{ alignSelf: "flex-start" }}>
                  <Button height={40} label={t.clientApp.builder.title} onPress={() => router.push("/build")} />
                </View>
              </View>
            ) : (
              programs.map((group) => (
                <View key={group.program_id} style={{ gap: 12, marginBottom: 8 }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                    <Text style={{ fontFamily: font.bold, fontSize: 12, letterSpacing: 0.72, textTransform: "uppercase", color: color.inkSoft }}>
                      {group.program_name}
                    </Text>
                    <Chip text={group.is_own ? w.byYou : w.byCoach} bg={color.surface} ink={color.inkFaint} />
                    {group.followed && programs.length > 1 ? <Chip text={w.followed} bg={color.accentSoft} ink={color.accentInk} /> : null}
                  </View>
                  {group.days.map((day) => (
                    <DayCard key={day.day_id} day={day} sex={data.sex} next={day.day_id === data.next_day_id} />
                  ))}
                  {group.is_own && !data.has_coach ? (
                    <Pressable
                      accessibilityRole="link"
                      onPress={() => router.push({ pathname: "/build", params: { program: group.program_id } })}
                      style={[styles.addDay, { borderColor: color.line }]}
                    >
                      <Text style={{ fontFamily: font.semibold, fontSize: 18, color: color.inkFaint }}>+</Text>
                      <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.inkFaint }}>{w.addAnotherDay}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))
            )}

            <Card flush>
              <Text style={{ paddingHorizontal: 20, paddingTop: 0, paddingBottom: 8, fontFamily: font.bold, fontSize: 14, color: color.ink }}>{w.history}</Text>
              {sessions.length === 0 ? (
                <T kind="faint" style={{ paddingHorizontal: 20, paddingBottom: 4, fontSize: 14 }}>{w.noSessions}</T>
              ) : (
                sessions.map((s) => (
                  <View key={s.id}>
                    <Divider />
                    <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: "/session/[id]", params: { id: s.id } })} style={styles.historyRow}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          numberOfLines={1}
                          style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}
                        >
                          {s.day_name}
                        </Text>
                        <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{s.ago}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 4, flexShrink: 0, maxWidth: "62%" }}>
                        <Text style={{ textAlign: "right", fontFamily: font.regular, fontSize: 12, color: color.inkSoft }}>
                          {`${s.duration_min !== null ? `${s.duration_min} min · ` : ""}${s.sets} ${t.clientApp.workoutDay.sets} · ${nf.format(s.volume_kg)} kg`}
                          {s.prs > 0 ? (
                            <Text style={{ fontFamily: font.semibold, color: color.accentInk }}>
                              {` · ${s.prs} ${s.prs === 1 ? t.clientApp.workoutDay.prOne : t.clientApp.workoutDay.prs}`}
                            </Text>
                          ) : null}
                        </Text>
                        <LoadBadge load={s.load} />
                      </View>
                    </Pressable>
                  </View>
                ))
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Chip({ text, bg, ink }: { text: string; bg: string; ink: string }) {
  return (
    <View style={{ borderRadius: 999, backgroundColor: bg, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ fontFamily: font.semibold, fontSize: 11, color: ink }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // 110 at the bottom: clear of the floating tab bar.
  body: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 110, gap: 16 },
  addDay: {
    minHeight: 80,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 24,
    borderWidth: 1,
    borderStyle: "dashed",
    padding: 16,
  },
  historyRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
});
