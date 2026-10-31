import type { WeightUnit } from "@healthapp/shared";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CreateForm, ProgramEditor, Switcher, useRun } from "@/components/program-editor";
import { Button, Card, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/role";
import { font, useTheme } from "@/lib/theme";


// The program builder — the web's /workout/build on a phone (solo-program-builder.tsx
// with its day editor): your own programs, one open at a time; its days (name,
// muscle groups, order, copy, delete), the exercises in each from the library,
// and their prescription (sets × reps, RIR, kg, rest, reps or time, your cue);
// then publish, set as active, delete. Every write is the web's own builder
// action through /api/v1/builder; a coached client is shown their coach's role.

export default function Build() {
  const params = useLocalSearchParams<{ program?: string }>();
  const { t } = useI18n();
  const { color } = useTheme();
  const b = t.clientApp.builder;
  const [programId, setProgramId] = useState<string | undefined>(params.program);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryKey = ["builder", programId ?? null];
  // Saves read this program back only; Training, Today and the routine page read once, on the way out.
  const [run, busy] = useRun(setError, { queryKey, onLeave: [["workouts"], ["today"], ["routines"]] });
  const query = useQuery({ queryKey, queryFn: () => api.builder(programId) });
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


const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 64, gap: 14 },
});
