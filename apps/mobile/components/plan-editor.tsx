import type { CoachPlanV1, FoodItemV1 } from "@healthapp/api/v1";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputInstance } from "react-native";
import { Button, Card, NavIcon, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { NewFoodForm } from "@/components/new-food-form";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// A nutrition plan — the web's /nutrition/[id] on a phone: the daily target,
// Every day (the base menu) and each weekday, the meals with their foods in
// grams (change the grams, remove a food, add one from the food search at
// 100 g), what the day adds up to, and Publish to client. A weekday shows the
// base menu's meal where it has no version of its own, and can get its own
// version of a meal, or extra meals of its own; a meal can link a recipe.

type Plan = CoachPlanV1;
type Meal = Plan["meals"][number];

/** solo: the person's own meal plan — no client, no status, no publishing (it already is their plan). */
export function PlanEditor({ plan, solo = false }: { plan: Plan; solo?: boolean }) {
  const { t, fill, named } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const n = t.coachApp.nutrition;
  const nb = t.coachWidgets.nutritionBuilder;
  const [day, setDay] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = plan.can_edit !== false;

  async function write(op: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.coachNutritionWrite(op, { planId: plan.id, ...body });
      if (!r.ok) setError(r.message ?? nb.somethingWentWrong);
      await queryClient.invalidateQueries({ queryKey: ["coach-nutrition"] });
      void queryClient.invalidateQueries({ queryKey: ["meal-plan"] });
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
  const shown: { meal: Meal; inherited: boolean }[] =
    day === 0
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
  const totals = day > 0 ? plan.days[day - 1] : null;

  return (
    <>
      {solo ? null : (
        <View style={{ gap: 4 }}>
          <T kind="title">{named("plan", plan.name)}</T>
          <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{plan.client_name}</Text>
        </View>
      )}
      {plan.can_edit === false ? <Text style={{ fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: color.warn }}>{solo ? t.common.actions.editUnverified : n.readOnly}</Text> : null}
      {plan.can_edit === null ? <T kind="faint">{t.common.actions.editUnverified}</T> : null}

      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {solo ? null : <View style={[styles.badge, { backgroundColor: plan.status === "published" ? color.accentSoft : color.surface }]}>
            <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: plan.status === "published" ? color.accentInk : color.inkSoft }}>{nb.status[plan.status]}</Text>
          </View>}
          <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
            {`${plan.target.kcal} ${n.kcal} · ${n.proteinShort} ${plan.target.protein} · ${n.carbsShort} ${plan.target.carbs} · ${n.fatShort} ${plan.target.fat}`}
          </Text>
        </View>
        {!solo && plan.status !== "published" ? (
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
      <T kind="faint">{day === 0 ? nb.everyDayIntro : fill(solo ? nb.dayIntroSolo : nb.dayIntro, { day: nb.weekdaysLong[day - 1] })}</T>

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
          canChange={editable}
          day={day}
          recipes={plan.recipes ?? []}
          busy={busy}
          write={write}
        />
      ))}
      {day > 0 && editable ? <ExtraMeals day={day} count={plan.meals.filter((m) => m.extra && m.day_index === day).length} busy={busy} write={write} /> : null}
      {error ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.risk }}>{error}</Text> : null}
    </>
  );
}

function MealCard({ meal, inherited, editable, canChange, day, recipes, busy, write }: {
  meal: Meal; inherited: boolean; editable: boolean;
  /** The plan may be changed at all (read-only once the coaching ended). */
  canChange: boolean;
  /** 0 = Every day, 1..7 = that weekday. */
  day: number;
  recipes: { id: string; title: string }[];
  busy: boolean;
  write: (op: string, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const { t, fill, named } = useI18n();
  const { color } = useTheme();
  const nb = t.coachWidgets.nutritionBuilder;
  const n = t.coachApp.nutrition;
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(meal.name);
  const mealName = named("meal", meal.name);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const dayName = day > 0 ? nb.weekdaysLong[day - 1] : "";
  const ownVersion = day > 0 && !inherited && !meal.extra && meal.day_index === day;
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        {renaming ? (
          <TextInput
            autoFocus
            value={name}
            onChangeText={setName}
            maxLength={60}
            placeholder={nb.extraNamePlaceholder}
            placeholderTextColor={color.inkFaint}
            accessibilityLabel={nb.extraName}
            onSubmitEditing={() => { setRenaming(false); if (name.trim() && name.trim() !== meal.name) void write("renameExtra", { mealId: meal.id, name: name.trim() }); }}
            style={[styles.search, { flex: 1, color: color.ink, backgroundColor: color.bg, borderColor: color.accent }]}
          />
        ) : (
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.displayBold, fontSize: 16, color: color.ink }}>{mealName}</Text>
        )}
        <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{`${Math.round(meal.totals.kcal)} ${n.kcal}`}</Text>
      </View>
      {meal.extra ? <Text style={{ marginTop: -6, fontFamily: font.semibold, fontSize: 11.5, color: color.accentInk }}>{fill(nb.extraBadge, { day: dayName })}</Text> : null}
      {inherited ? <Text style={{ marginTop: -6, fontFamily: font.semibold, fontSize: 11.5, color: color.inkFaint }}>{nb.inherited}</Text> : null}

      {meal.recipe_title ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 12.5, color: color.accentInk }}>{`${nb.recipe}: ${meal.recipe_title}`}</Text>
          {editable && canChange ? <Text accessibilityRole="button" onPress={busy ? undefined : () => void write("recipe", { mealId: meal.id, recipeId: null })} style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkFaint }}>{nb.unlinkRecipe}</Text> : null}
        </View>
      ) : null}
      {meal.foods.length === 0 ? <T kind="faint">{nb.nothingPlanned}</T> : null}
      {meal.foods.map((f) => (
        <FoodRow key={f.id} food={f} editable={editable} busy={busy} write={write} />
      ))}
      {editable ? (
        adding ? (
          <FoodSearch mealName={mealName} onClose={() => setAdding(false)} onPick={(food) => void write("addFood", { mealId: meal.id, foodId: food.id, grams: 100 })} />
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

      {/* the meal's recipe link: one of the editor's own recipes, for cooking only */}
      {editable && canChange && !meal.recipe_title ? (
        choosing ? (
          <View style={{ gap: 6 }}>
            <T kind="faint">{nb.recipeHint}</T>
            {recipes.length === 0 ? <T kind="faint">{nb.noRecipes}</T> : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {recipes.map((r) => (
                <Pressable key={r.id} accessibilityRole="button" disabled={busy} onPress={async () => { if (await write("recipe", { mealId: meal.id, recipeId: r.id })) setChoosing(false); }} style={[styles.chip, { backgroundColor: color.bg }]}>
                  <Text numberOfLines={1} style={{ maxWidth: 200, fontFamily: font.semibold, fontSize: 12, color: color.inkSoft }}>{r.title}</Text>
                </Pressable>
              ))}
            </View>
            <Text accessibilityRole="button" onPress={() => setChoosing(false)} style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkFaint }}>{t.common.actions.cancel}</Text>
          </View>
        ) : (
          <Text accessibilityRole="button" onPress={() => setChoosing(true)} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{nb.chooseRecipe}</Text>
        )
      ) : null}

      {/* a weekday: make this meal its own, or go back to the every-day one */}
      {canChange && inherited ? (
        <View style={{ gap: 6 }}>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void write("variant", { mealId: meal.id, dayIndex: day, copyFoods: true })} style={[styles.quiet, { backgroundColor: color.bg }]}>
            <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.ink }}>{fill(nb.customize, { day: dayName })}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{fill(nb.customizeHint, { day: dayName })}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void write("variant", { mealId: meal.id, dayIndex: day, copyFoods: false })} style={[styles.quiet, { backgroundColor: color.bg }]}>
            <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.ink }}>{fill(nb.replaceEmpty, { day: dayName })}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{fill(nb.replaceEmptyHint, { day: dayName })}</Text>
          </Pressable>
        </View>
      ) : null}
      {canChange && ownVersion ? (
        <Text accessibilityRole="button" onPress={busy ? undefined : () => void write("removeVariant", { mealId: meal.id })} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{nb.backToEveryDay}</Text>
      ) : null}

      {/* an extra meal: rename, remove */}
      {canChange && meal.extra ? (
        confirmRemove ? (
          <View style={{ gap: 6 }}>
            <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.ink }}>{fill(nb.removeExtraConfirm, { name: mealName, day: dayName })}</Text>
            <View style={{ flexDirection: "row", gap: 14 }}>
              <Text accessibilityRole="button" onPress={busy ? undefined : () => void write("removeExtra", { mealId: meal.id })} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{nb.removeExtraYes}</Text>
              <Text accessibilityRole="button" onPress={() => setConfirmRemove(false)} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{t.common.actions.cancel}</Text>
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: 14 }}>
            <Text accessibilityRole="button" onPress={() => { setName(meal.name); setRenaming(true); }} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{nb.rename}</Text>
            <Text accessibilityRole="button" onPress={() => setConfirmRemove(true)} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{nb.removeExtra}</Text>
          </View>
        )
      ) : null}
    </Card>
  );
}

/** Extra meals on one weekday, on top of the slot meals: a name and the diary meal it logs into, at most four. */
function ExtraMeals({ day, count, busy, write }: { day: number; count: number; busy: boolean; write: (op: string, body: Record<string, unknown>) => Promise<boolean> }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const nb = t.coachWidgets.nutritionBuilder;
  const slots = t.clientApp.food as unknown as Record<string, string>;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slot, setSlot] = useState<"breakfast" | "lunch" | "dinner" | "snack">("snack");
  const dayName = nb.weekdaysLong[day - 1]!;
  return (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <T kind="label">{fill(nb.extraMeals, { day: dayName })}</T>
        <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{fill(nb.extraCount, { n: count })}</Text>
      </View>
      <T kind="faint">{fill(nb.extraMealsHint, { day: dayName })}</T>
      {open ? (
        <View style={{ gap: 8 }}>
          <TextInput autoFocus value={name} onChangeText={setName} maxLength={60} placeholder={nb.extraNamePlaceholder} placeholderTextColor={color.inkFaint} accessibilityLabel={nb.extraName} style={[styles.search, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]} />
          <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: color.inkSoft }}>{nb.extraLogsInto}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {(["breakfast", "lunch", "dinner", "snack"] as const).map((s) => (
              <Pressable key={s} accessibilityRole="radio" accessibilityState={{ checked: s === slot }} onPress={() => setSlot(s)} style={[styles.chip, { backgroundColor: s === slot ? color.accent : color.bg }]}>
                <Text style={{ fontFamily: font.semibold, fontSize: 12, color: s === slot ? color.accentFg : color.inkSoft }}>{slots[s]}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Button
              height={38}
              label={nb.save}
              busy={busy}
              disabled={!name.trim()}
              onPress={async () => {
                if (await write("addExtra", { dayIndex: day, slot, name: name.trim() })) { setName(""); setOpen(false); }
              }}
            />
            <Text accessibilityRole="button" onPress={() => setOpen(false)} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{t.common.actions.cancel}</Text>
          </View>
        </View>
      ) : count < 4 ? (
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => setOpen(true)} style={[styles.add, { borderColor: color.line }]}>
          <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{nb.addExtra}</Text>
        </Pressable>
      ) : <T kind="faint">{nb.extraLimit}</T>}
    </Card>
  );
}

/**
 * One food in a meal: its grams save as the field is left; ✕ takes it out.
 * Android's Back closes the keyboard without blurring the field, and leaving
 * the screen then never blurs it at all — so a closed keyboard blurs it, and
 * grams still typed but unsaved when the row goes away are saved then.
 */
function FoodRow({ food, editable, busy, write }: {
  food: Meal["foods"][number]; editable: boolean; busy: boolean;
  write: (op: string, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const { color } = useTheme();
  const nb = t.coachWidgets.nutritionBuilder;
  const [grams, setGrams] = useState(String(food.grams));
  useEffect(() => setGrams(String(food.grams)), [food.grams]);
  const input = useRef<TextInputInstance>(null);
  // what the field holds and what was last sent, for the unmount below (no stale closure)
  const typed = useRef(grams);
  typed.current = grams;
  const sent = useRef<number | null>(null);
  useEffect(() => { sent.current = null; }, [food.grams]);
  const pending = (): number | null => {
    const g = Number(typed.current.replace(",", "."));
    return g > 0 && g !== food.grams && g !== sent.current ? g : null;
  };
  const commit = () => {
    const g = pending();
    if (g !== null) {
      sent.current = g;
      void write("grams", { rowId: food.id, grams: g });
    } else if (!(Number(typed.current.replace(",", ".")) > 0)) setGrams(String(food.grams));
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      if (input.current?.isFocused()) input.current.blur();
    });
    return () => {
      hide.remove();
      commitRef.current();
    };
  }, []);
  return (
    <View style={[styles.food, { backgroundColor: color.bg }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{food.food_name}</Text>
        <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{`${Math.round(food.macros.kcal)} kcal`}</Text>
      </View>
      {editable ? (
        <>
          <TextInput
            ref={input}
            value={grams}
            onChangeText={setGrams}
            keyboardType="decimal-pad"
            editable={!busy}
            accessibilityLabel={`${food.food_name} ${nb.gramsLabel}`}
            onBlur={commit}
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
  const [creating, setCreating] = useState(false);
  if (creating) {
    // a food the search does not have, created where it came up short and added at once (nutrition-builder.tsx)
    return <NewFoodForm initialName={q} primaryLabel={t.clientWidgets.newFoodForm.saveAndLog} onCreated={(food) => { setCreating(false); onPick(food); }} onCancel={() => setCreating(false)} />;
  }
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
      <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>
        {`${t.clientWidgets.foodLogger.notFound} `}
        <Text accessibilityRole="button" onPress={() => setCreating(true)} style={{ fontFamily: font.semibold, color: color.accentInk }}>{t.clientWidgets.foodLogger.createFood}</Text>
      </Text>
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
  chip: { minHeight: 32, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, justifyContent: "center" },
  quiet: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, gap: 2 },
  hit: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, padding: 10 },
});
