import { MEAL_SLOTS_V1, type FoodDayV1, type MealSlotV1 } from "@healthapp/api/v1";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Screen, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { diary, shiftDay, sumMacros, totalsWithPending, type DiaryEntry } from "@/lib/food-model";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { queuedFoodFor } from "@/lib/outbox-core";
import { useOutbox } from "@/lib/outbox";
import { minTouchTarget, radius, space, useTheme } from "@/lib/theme";

// The food diary for one day — the web's /food: targets and totals, the four
// meals, the coach's planned meal with "ate as planned". A log added here goes
// through the outbox, so it shows at once and is sent when there is signal.
export default function Food() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const { session } = useAuth();
  const outbox = useOutbox();
  const queryClient = useQueryClient();
  const [day, setDay] = useState<string | null>(null);
  const query = useOfflineQuery(`food:${day ?? "today"}`, ["food", day ?? "today"], () => api.foodDay(day ?? undefined));
  const data = query.data?.data;
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const shownDay = data?.day ?? day;
  const queued = data && session ? queuedFoodFor(outbox.items, session.user.id, data.day) : [];

  async function online(key: string, work: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(key);
    setMessage(null);
    try {
      const result = await work();
      if (!result.ok) setMessage(result.message ?? t.mobile.errors.generic);
      await queryClient.invalidateQueries({ queryKey: ["food"] });
      void queryClient.invalidateQueries({ queryKey: ["today"] });
    } catch (error) {
      setMessage(error instanceof ApiFailure && error.kind === "offline" ? t.mobile.food.needsSignal : t.mobile.errors.generic);
    } finally {
      setBusy(null);
    }
  }

  const slotTitle: Record<MealSlotV1, string> = {
    breakfast: t.clientApp.food.breakfast, lunch: t.clientApp.food.lunch, dinner: t.clientApp.food.dinner, snack: t.clientApp.food.snack,
  };

  return (
    <Screen>
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
        >
          <View style={styles.dayRow}>
            <NavButton label="‹" a11y={t.mobile.food.previousDay} onPress={() => shownDay && setDay(shiftDay(shownDay, -1))} />
            <View style={{ flex: 1, alignItems: "center" }}>
              <T kind="heading">{dayLabel(shownDay, data)}</T>
            </View>
            <NavButton
              label="›"
              a11y={t.mobile.food.nextDay}
              disabled={!data || data.day >= data.today}
              onPress={() => shownDay && setDay(shiftDay(shownDay, 1))}
            />
          </View>
          {query.data?.fromPhone ? <T kind="faint">{t.mobile.workout.fromPhone}</T> : null}

          {!data ? (
            query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: space.xxl }} />
          ) : (
            <>
              <Totals day={data} queued={queued} />
              {message ? <T style={{ color: color.risk }}>{message}</T> : null}
              {MEAL_SLOTS_V1.map((slot) => {
                const entries = diary(data, queued)[slot];
                const planned = data.planned.filter((m) => m.slot === slot);
                return (
                  <Card key={slot}>
                    <View style={styles.slotHead}>
                      <T kind="heading" style={{ flex: 1 }}>{slotTitle[slot]}</T>
                      {entries.length > 0 ? <T kind="faint">{`${Math.round(sumMacros(entries).kcal)} ${t.mobile.food.kcal}`}</T> : null}
                    </View>
                    {entries.length === 0 ? <T kind="faint">{t.clientApp.food.nothingLogged}</T> : null}
                    {entries.map((e) => (
                      <EntryRow
                        key={e.id ?? e.localId}
                        e={e}
                        busy={busy === e.id}
                        onRemove={e.id ? () => void online(e.id!, () => api.deleteFoodLog(e.id!)) : undefined}
                      />
                    ))}
                    {planned.map((m) => (
                      <View key={m.id} style={[styles.planned, { borderColor: color.line }]}>
                        <T kind="faint">{m.extra ? fill(t.clientApp.food.extraMeal, { name: m.name }) : `${t.clientApp.food.coachPlanned}: ${m.name}`}</T>
                        <T kind="soft">{m.foods.map((f) => `${f.name} ${Math.round(f.grams)} g`).join(" · ")}</T>
                        <Button
                          kind="quiet"
                          label={t.clientApp.food.ateAsPlanned}
                          busy={busy === m.id}
                          onPress={() => void online(m.id, () => api.ateAsPlanned(slot, data.day, m.extra ? m.id : undefined))}
                        />
                      </View>
                    ))}
                    <Button
                      label={`+ ${t.mobile.food.add}`}
                      onPress={() => router.push({ pathname: "/food/add", params: { slot, day: data.day } })}
                    />
                  </Card>
                );
              })}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );

  function dayLabel(d: string | null, food: FoodDayV1 | undefined): string {
    if (!d || !food) return t.mobile.food.today;
    if (d === food.today) return t.mobile.food.today;
    if (d === shiftDay(food.today, -1)) return t.mobile.food.yesterday;
    return d;
  }
}

function Totals({ day, queued }: { day: FoodDayV1; queued: Parameters<typeof totalsWithPending>[1] }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const totals = totalsWithPending(day, queued);
  const target = day.target;
  const pct = target.kcal > 0 ? Math.min(1, totals.kcal / target.kcal) : 0;
  return (
    <Card>
      <T kind="title">
        {target.kcal > 0
          ? fill(t.mobile.food.ofTarget, { eaten: Math.round(totals.kcal), target: Math.round(target.kcal) })
          : `${Math.round(totals.kcal)} ${t.mobile.food.kcal}`}
      </T>
      {target.kcal > 0 ? (
        <View style={[styles.track, { backgroundColor: color.line }]}>
          <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: color.accent }]} />
        </View>
      ) : (
        <T kind="faint">{t.mobile.today.noTarget}</T>
      )}
      <View style={styles.macros}>
        {(["protein", "carbs", "fat"] as const).map((k) => (
          <T key={k} kind="soft">{`${t.mobile.food[k]} ${Math.round(totals[k])}${target[k] > 0 ? ` / ${Math.round(target[k])}` : ""} g`}</T>
        ))}
      </View>
    </Card>
  );
}

function EntryRow({ e, busy, onRemove }: { e: DiaryEntry; busy: boolean; onRemove?: () => void }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const tone = e.state === "refused" ? color.risk : e.state === "pending" ? color.inkFaint : color.ink;
  return (
    <View style={styles.entry}>
      <View style={{ flex: 1, gap: 2 }}>
        <T style={{ color: tone }}>{`${e.state === "pending" ? "◷ " : e.state === "refused" ? "! " : ""}${e.food_name}`}</T>
        <T kind="faint">
          {`${Math.round(e.grams)} g · ${Math.round(e.macros.kcal)} ${t.mobile.food.kcal}`}
          {e.state === "pending" ? ` · ${t.mobile.workout.waiting}` : ""}
          {e.state === "refused" && e.error ? ` · ${fill(t.mobile.workout.refused, { message: e.error })}` : ""}
        </T>
      </View>
      {onRemove ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${t.mobile.food.remove} ${e.food_name}`} onPress={onRemove} style={styles.remove}>
          {busy ? <ActivityIndicator color={color.inkFaint} /> : <T kind="faint">✕</T>}
        </Pressable>
      ) : null}
    </View>
  );
}

function NavButton({ label, a11y, onPress, disabled }: { label: string; a11y: string; onPress: () => void; disabled?: boolean }) {
  const { color } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.nav, { borderColor: color.line, opacity: disabled ? 0.35 : 1 }]}
    >
      <T kind="heading">{label}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  dayRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  nav: { minWidth: minTouchTarget, minHeight: minTouchTarget, borderWidth: 1, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  slotHead: { flexDirection: "row", alignItems: "center" },
  entry: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: minTouchTarget },
  remove: { minWidth: minTouchTarget, minHeight: minTouchTarget, alignItems: "center", justifyContent: "center" },
  planned: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: space.xs },
  macros: { flexDirection: "row", justifyContent: "space-between" },
  track: { height: 8, borderRadius: radius.pill, overflow: "hidden" },
  fill: { height: 8, borderRadius: radius.pill },
});
