import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, NavIcon, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { alpha, font, useTheme } from "@/lib/theme";

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
  const c = t.mobile.coach;

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

  const section = (label: string, count: number | null) => (
    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: 4 }}>
      <Text style={styles.label(color.inkFaint)}>{label}</Text>
      {count !== null ? <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkFaint }}>{count}</Text> : null}
    </View>
  );

  return (
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
        <T kind="title">{c.inbox}</T>
        {error ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.risk }}>{error}</Text> : null}

        <View style={{ gap: 8 }}>
          {section(c.checkInsTitle, checkIns.data ? checkIns.data.data.length : null)}
          {!checkIns.data ? (
            checkIns.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} />
          ) : checkIns.data.data.length === 0 ? (
            <T kind="faint" style={{ paddingHorizontal: 4 }}>{c.noCheckIns}</T>
          ) : (
            <View style={{ borderRadius: 24, overflow: "hidden", backgroundColor: color.surface }}>
              {checkIns.data.data.map((x, i) => (
                <Pressable
                  key={x.id}
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: "/coach/check-in/[id]", params: { id: x.id } })}
                  style={({ pressed }) => [styles.row, i > 0 ? { borderTopWidth: 1, borderTopColor: alpha(color.line, 0.5) } : null, pressed ? { backgroundColor: alpha(color.bg, 0.6) } : null]}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 14.5, color: color.ink }}>{x.name}</Text>
                    <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{x.week_start}</Text>
                    {x.note ? <Text numberOfLines={2} style={{ marginTop: 4, fontFamily: font.regular, fontStyle: "italic", fontSize: 13, color: color.inkSoft }}>{`“${x.note}”`}</Text> : null}
                  </View>
                  <View style={[styles.action, { backgroundColor: color.bg }]}>
                    <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{c.review}</Text>
                    <NavIcon d="m9 6 6 6-6 6" size={14} color={color.accentInk} strokeWidth={2.2} />
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <View style={{ gap: 8 }}>
          {section(c.requestsTitle, requests.data ? requests.data.data.length : null)}
          {!requests.data ? (
            requests.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} />
          ) : requests.data.data.length === 0 ? (
            <T kind="faint" style={{ paddingHorizontal: 4 }}>{c.noRequests}</T>
          ) : (
            <>
              <T kind="faint" style={{ paddingHorizontal: 4 }}>{c.acceptHint}</T>
              {requests.data.data.map((r) => (
                <Card key={r.id} style={{ gap: 0 }}>
                  <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{r.client_name}</Text>
                  {r.service_name ? <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{r.service_name}</Text> : null}
                  {r.goal ? <Text style={{ marginTop: 8, fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{r.goal}</Text> : null}
                  {r.message ? <Text style={{ marginTop: 6, fontFamily: font.regular, fontStyle: "italic", fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{`“${r.message}”`}</Text> : null}
                  <View style={{ marginTop: 14, flexDirection: "row", gap: 8 }}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy === r.id}
                      onPress={() => void respond(r.id, true)}
                      style={[styles.button, { flex: 1, backgroundColor: color.accent, opacity: busy === r.id ? 0.5 : 1 }]}
                    >
                      <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.accentFg }}>{c.accept}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy === r.id}
                      onPress={() => void respond(r.id, false)}
                      style={[styles.button, { flex: 1, backgroundColor: color.bg }]}
                    >
                      <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.inkSoft }}>{c.decline}</Text>
                    </Pressable>
                  </View>
                </Card>
              ))}
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = {
  ...StyleSheet.create({
    // 110 at the bottom: clear of the floating tab bar.
    body: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 110, gap: 20 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
    action: { height: 36, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 18, paddingHorizontal: 14 },
    button: { height: 44, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  }),
  label: (ink: string) => ({ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" as const, color: ink }),
};
