import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ProgramEditor, useRun } from "@/components/program-editor";
import { T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/role";
import { font, useTheme } from "@/lib/theme";

// One of the coach's programs — the web's /programs/[id] on a phone: the same
// editor as the client's own builder (components/program-editor.tsx), with the
// client's name, "Publish to client", and read-only once the coaching ended or
// paused (can_edit_program). Duplicate and assign stay on the routine page.

export default function CoachProgram() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { color } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const queryKey = ["builder", "coach", id];
  // Saves read this program back only; the program list, the client's page and the routine page read once, on the way out.
  const [run, busy] = useRun(setError, { queryKey, onLeave: [["builder", "coach"], ["coach-client"], ["routines"]] });
  const query = useQuery({ queryKey, queryFn: () => api.coachProgram(id) });
  const program = query.data;
  const unit = useMe().data?.data.weight_unit ?? "kg";

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.coachApp.programBuilderPage.back} />
        {!program ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : (
          <>
            <ProgramEditor
              program={program}
              run={run}
              busy={busy}
              unit={unit}
              coach={{ clientName: program.client_name, canEdit: program.can_edit !== false }}
              onDeleted={() => router.back()}
            />
            {program.can_edit === null ? <T kind="faint">{t.common.actions.editUnverified}</T> : null}
            <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: "/routine/[id]", params: { id: program.id } })}>
              <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{`${t.clientApp.routines.editDetails} →`}</Text>
            </Pressable>
          </>
        )}
        {error ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.risk }}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 64, gap: 14 },
});
