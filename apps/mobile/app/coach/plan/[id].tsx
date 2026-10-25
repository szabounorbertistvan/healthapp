import type { CoachPlanV1, FoodItemV1 } from "@healthapp/api/v1";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, NavIcon, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// One nutrition plan — the web's /nutrition/[id] on a phone: the daily target,
// Every day (the base menu) and each weekday, the meals with their foods in
// grams (change the grams, remove a food, add one from the food search at
// 100 g), what the day adds up to, and Publish to client. A weekday shows the
// base menu's meal where it has no version of its own. Weekday versions, extra
// meals and recipe links are edited on the web; here they are shown.

type Plan = CoachPlanV1;
type Meal = Plan["meals"][number];

export default function CoachPlan() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const n = t.coachApp.nutrition;
  const nb = t.coachWidgets.nutritionBuilder;
  const query = useQuery({ queryKey: ["coach-nutrition", id], queryFn: () => api.coachPlan(id) });
  const plan = query.data;
  const [day, setDay] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = plan ? plan.can_edit !== false : false;

  async function write(op: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.coachNutritionWrite(op, { planId: id, ...body });
      if (!r.ok) setError(r.message ?? nb.somethingWentWrong);
      await queryClient.invalidateQueries({ queryKey: ["coach-nutrition"] });
      return r.ok;
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : nb.somethingWentWrong);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // What the selected day shows: the base menu, or a weekday's own meals with
  // the base menu's in each slot it has no version of (marked inherited).
  const shown: { meal: Meal; inherited: boolean }[] = !plan
    ? []
    : day === 0
      ? plan.meals.filter((m) => m.day_index === 0 && !m.extra).map((meal) => ({ meal, inherited: false }))
      : [
          ...plan.meals
            .filter((m) => m.day_index === 0 && !m.extra)
            .map((base) => {
              const own = plan.meals.find((m) => m.day_index === day && !m.extra && m.slot === base.slot);
              return own ? { meal: own, inherited: false } : { meal: base, inherited: true };
            }),
          ...plan.meals.filter((m) => m.day_index === day && m.extra).map((meal) => ({ meal, inherited: false })),
        ];
  const totals = plan && day > 0 ? plan.days[day - 1] : null;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={n.back} />
        {!plan ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : (
          <>
            <View style={{ gap: 4 }}>
              <T kind="title">{plan.name}</T>
              <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{plan.client_name}</Text>
            </View>
            {plan.can_edit === false ? <Text style={{ fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: color.warn }}>{n.readOnly}</Text> : null}
            {plan.can_edit === null ? <T kind="faint">{t.common.actions.editUnverified}</T> : null}

            <Card style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={[styles.badge, { backgroundColor: plan.status === "published" ? color.accentSoft : color.surface }]}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: plan.status === "published" ? color.accentInk : color.inkSoft }}>{nb.status[plan.status]}</Text>
                </View>
                <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
                  {`${plan.target.kcal} ${n.kcal} · ${n.proteinShort} ${plan.target.protein} · ${n.carbsShort} ${plan.target.carbs} · ${n.fatShort} ${plan.target.fat}`}
                </Text>
              </View>
              {plan.status !== "published" ? (
                <>
                  <T kind="soft">{fill(nb.draftNotice, { name: plan.client_name })}</T>
                  <View style={{ alignSelf: "flex-start" }}>
                    <Button height={40} label={nb.publish} busy={busy} disabled={!editable} onPress={() => void write("publish", {})} />
                  </View>
                </>
              ) : null}
            </Card>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {[nb.everyDay, ...nb.weekdays].map((label, i) => (
                <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected: i === day }} onPress={() => setDay(i)} style={[styles.tab, { backgroundColor: i === day ? color.accent : color.surface }]}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: i === day ? color.accentFg : color.inkSoft }}>{label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <T kind="faint">{day === 0 ? nb.everyDayIntro : fill(nb.dayIntro, { day: nb.weekdaysLong[day - 1] })}</T>

            {totals ? (
              <Card style={{ gap: 4 }}>
                <T kind="label">{fill(nb.dayTotalsFor, { day: nb.weekdaysLong[day - 1] })}</T>
                <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{`${Math.round(totals.kcal)} / ${plan.target.kcal} ${n.kcal}`}</Text>
                <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>
                  {`${n.proteinShort} ${Math.round(totals.protein)} · ${n.carbsShort} ${Math.round(totals.carbs)} · ${n.fatShort} ${Math.round(totals.fat)}`}
                </Text>
              </Card>
            ) : null}

            {shown.map(({ meal, inherited }) => (
              <MealCard
                key={`${meal.id}-${day}`}
                meal={meal}
                inherited={inherited}
                editable={editable && !inherited && plan.foods_allowed}
                busy={busy}
                write={write}
              />
            ))}
            {error ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.risk }}>{error}</Text> : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function MealCard({ meal, inherited, editable, busy, write }: {
  meal: Meal; inherited: boolean; editable: boolean; busy: boolean;
  write: (op: string, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const { color } = useTheme();
  const nb = t.coachWidgets.nutritionBuilder;
  const n = t.coachApp.nutrition;
  const [adding, setAdding] = useState(false);
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.displayBold, fontSize: 16, color: color.ink }}>{meal.name}</Text>
        <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{`${Math.round(meal.totals.kcal)} ${n.kcal}`}</Text>
      </View>
      {inherited ? <Text style={{ marginTop: -6, fontFamily: font.semibold, fontSize: 11.5, color: color.inkFaint }}>{nb.inherited}</Text> : null}
      {meal.recipe_title ? <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.accentInk }}>{`${nb.recipe}: ${meal.recipe_title}`}</Text> : null}
      {meal.foods.length === 0 ? <T kind="faint">{nb.nothingPlanned}</T> : null}
      {meal.foods.map((f) => (
        <FoodRow key={f.id} food={f} editable={editable} busy={busy} write={write} />
      ))}
      {editable ? (
        adding ? (
          <FoodSearch mealName={meal.name} onClose={() => setAdding(false)} onPick={(food) => void write("addFood", { mealId: meal.id, foodId: food.id, grams: 100 })} />
        ) : (
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => setAdding(true)} style={[styles.add, { borderColor: color.line }]}>
            <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{`+ ${nb.addFood}`}</Text>
          </Pressable>
        )
      ) : null}
      {meal.foods.length > 0 ? (
        <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>
          {`${n.proteinShort} ${Math.round(meal.totals.protein)} · ${n.carbsShort} ${Math.round(meal.totals.carbs)} · ${n.fatShort} ${Math.round(meal.totals.fat)}`}
        </Text>
      ) : null}
      {adding ? <T kind="faint">{nb.addedAt100}</T> : null}
    </Card>
  );
}

/** One food in a meal: its grams save as the field is left; ✕ takes it out. */
function FoodRow({ food, editable, busy, write }: {
  food: Meal["foods"][number]; editable: boolean; busy: boolean;
  write: (op: string, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const { color } = useTheme();
  const nb = t.coachWidgets.nutritionBuilder;
  const [grams, setGrams] = useState(String(food.grams));
  useEffect(() => setGrams(String(food.grams)), [food.grams]);
  return (
    <View style={[styles.food, { backgroundColor: color.bg }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{food.food_name}</Text>
        <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{`${Math.round(food.macros.kcal)} kcal`}</Text>
      </View>
      {editable ? (
        <>
          <TextInput
            value={grams}
            onChangeText={setGrams}
            keyboardType="decimal-pad"
            editable={!busy}
            accessibilityLabel={`${food.food_name} ${nb.gramsLabel}`}
            onBlur={() => {
              const g = Number(grams.replace(",", "."));
              if (g > 0 && g !== food.grams) void write("grams", { rowId: food.id, grams: g });
              else setGrams(String(food.grams));
            }}
            style={[styles.grams, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }]}
          />
          <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>g</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={nb.removeFood} disabled={busy} onPress={() => void write("removeFood", { rowId: food.id })} hitSlop={6} style={{ padding: 4, opacity: busy ? 0.4 : 1 }}>
            <NavIcon d="M6 6 18 18M18 6 6 18" size={16} color={color.risk} />
          </Pressable>
        </>
      ) : (
        <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{`${food.grams} g`}</Text>
      )}
    </View>
  );
}

/** The food search (the same /foods/search the client's food log uses); a pick adds it at 100 g. */
function FoodSearch({ mealName, onPick, onClose }: { mealName: string; onPick: (f: FoodItemV1) => void; onClose: () => void }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const nb = t.coachWidgets.nutritionBuilder;
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(h);
  }, [typed]);
  const query = useQuery({ queryKey: ["foods", q], queryFn: () => api.searchFoods(q), enabled: q.length >= 2 });
  return (
    <View style={[styles.picker, { borderColor: color.line, backgroundColor: color.bg }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{fill(nb.addTo, { name: mealName })}</Text>
        <Text accessibilityRole="button" onPress={onClose} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{nb.closeFoods}</Text>
      </View>
      <TextInput
        autoFocus
        value={typed}
        onChangeText={setTyped}
        autoCorrect={false}
        placeholder={nb.searchFoods}
        placeholderTextColor={color.inkFaint}
        accessibilityLabel={nb.searchFoods}
        style={[styles.search, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }]}
      />
      {q.length >= 2 && query.isFetching && !query.data ? <ActivityIndicator color={color.accent} /> : null}
      {query.data && query.data.length === 0 ? <T kind="faint">{nb.noMatch}</T> : null}
      {(query.data ?? []).slice(0, 20).map((f) => (
        <Pressable key={f.id} accessibilityRole="button" onPress={() => onPick(f)} style={[styles.hit, { backgroundColor: color.surface }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>
              {`${locale === "ro" ? f.name_ro : f.name_en}${f.english_only ? ` · ${nb.englishOnly}` : ""}`}
            </Text>
            <Text numberOfLines={1} style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>
              {[f.brand, `${Math.round(f.per_100g.kcal)} kcal / 100 g`].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <Text style={{ fontFamily: font.bold, fontSize: 13, color: color.accentInk }}>{`+ ${t.common.actions.add}`}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 64, gap: 14 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  tab: { height: 38, borderRadius: 19, paddingHorizontal: 14, justifyContent: "center" },
  food: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  grams: { width: 64, height: 38, borderRadius: 10, borderWidth: 1, textAlign: "center", fontFamily: font.semibold, fontSize: 14 },
  add: { height: 40, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  picker: { borderRadius: 16, borderWidth: 1, padding: 12, gap: 8 },
  search: { height: 44, borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, fontFamily: font.regular, fontSize: 14 },
  hit: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, padding: 10 },
});
