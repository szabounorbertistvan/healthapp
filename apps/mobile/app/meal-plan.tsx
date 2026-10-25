import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PlanEditor } from "@/components/plan-editor";
import { Button, Card, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// My meal plan — the web's /food/plan on a phone: the person's own plan on
// their own targets, in the same editor as a coach's plan, without publishing.
// While a coach is active their plan applies, and this says so.

export default function MealPlan() {
  const { t } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const m = t.clientApp.mealPlan;
  const query = useQuery({ queryKey: ["meal-plan"], queryFn: api.mealPlan });
  const d = query.data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.startMealPlan();
      if (!r.ok) setError(r.message ?? t.coachWidgets.nutritionBuilder.somethingWentWrong);
      await queryClient.invalidateQueries({ queryKey: ["meal-plan"] });
    } catch {
      setError(t.mobile.errors.offline);
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
        <BackHeader label={t.common.nav.nutrition} />
        <View>
          <T kind="title">{m.title}</T>
          <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{m.intro}</Text>
        </View>
        {!d ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : d.coached ? (
          <Card><T kind="soft" style={{ lineHeight: 19 }}>{m.coachActive}</T></Card>
        ) : !d.solo ? (
          <Card style={{ gap: 8 }}>
            <T kind="soft" style={{ lineHeight: 19 }}>{m.noTargets}</T>
            <Text accessibilityRole="link" onPress={() => router.navigate("/food")} style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{m.setTargets}</Text>
          </Card>
        ) : !d.solo.has_meals || !d.plan ? (
          <Card style={{ gap: 8 }}>
            <T kind="soft">{m.startHint}</T>
            <View style={{ alignSelf: "flex-start" }}>
              <Button height={42} label={busy ? m.starting : m.start} busy={busy} onPress={() => void start()} />
            </View>
            {error ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
          </Card>
        ) : (
          <PlanEditor plan={d.plan} solo />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 64, gap: 14 },
});
