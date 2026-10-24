import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Screen, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { space, useTheme } from "@/lib/theme";

// What waits for the coach: check-ins to review (oldest first, as the web's
// /check-ins) and coaching requests to answer (the web's /requests).
export default function Inbox() {
  const { t } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const checkIns = useOfflineQuery("coach-check-ins", ["coach-check-ins"], api.coachCheckIns);
  const requests = useOfflineQuery("coach-requests", ["coach-requests"], api.coachRequests);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function respond(requestId: string, accept: boolean) {
    setBusy(requestId);
    setError(null);
    try {
      const result = await api.respondRequest(requestId, accept);
      if (!result.ok) setError(result.message ?? t.mobile.errors.generic);
      await queryClient.invalidateQueries({ queryKey: ["coach-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["coach-dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["coach-conversations"] });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.food.needsSignal : t.mobile.errors.generic);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen>
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl
              refreshing={checkIns.isRefetching || requests.isRefetching}
              onRefresh={() => {
                void checkIns.refetch();
                void requests.refetch();
              }}
              tintColor={color.accent}
            />
          }
        >
          <T kind="title">{t.mobile.coach.inbox}</T>
          {error ? <T style={{ color: color.risk }}>{error}</T> : null}

          <T kind="heading">{t.mobile.coach.checkInsTitle}</T>
          {!checkIns.data ? (
            checkIns.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} />
          ) : checkIns.data.data.length === 0 ? (
            <T kind="soft">{t.mobile.coach.noCheckIns}</T>
          ) : (
            checkIns.data.data.map((c) => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: "/coach/check-in/[id]", params: { id: c.id } })}
              >
                <Card>
                  <View style={styles.row}>
                    <T kind="heading" style={{ flex: 1 }}>{c.name}</T>
                    <T kind="accent">{`${t.mobile.coach.review} ›`}</T>
                  </View>
                  <T kind="faint">{c.week_start}</T>
                  {c.note ? <T kind="soft" style={{ fontStyle: "italic" }}>{`“${c.note}”`}</T> : null}
                </Card>
              </Pressable>
            ))
          )}

          <T kind="heading" style={{ marginTop: space.md }}>{t.mobile.coach.requestsTitle}</T>
          {!requests.data ? (
            requests.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} />
          ) : requests.data.data.length === 0 ? (
            <T kind="soft">{t.mobile.coach.noRequests}</T>
          ) : (
            <>
              <T kind="faint">{t.mobile.coach.acceptHint}</T>
              {requests.data.data.map((r) => (
                <Card key={r.id}>
                  <T kind="heading">{r.client_name}</T>
                  {r.service_name ? <T kind="faint">{r.service_name}</T> : null}
                  {r.goal ? <T kind="soft">{r.goal}</T> : null}
                  {r.message ? <T kind="soft" style={{ fontStyle: "italic" }}>{`“${r.message}”`}</T> : null}
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Button label={t.mobile.coach.accept} busy={busy === r.id} onPress={() => void respond(r.id, true)} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button kind="quiet" label={t.mobile.coach.decline} onPress={() => void respond(r.id, false)} />
                    </View>
                  </View>
                </Card>
              ))}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
