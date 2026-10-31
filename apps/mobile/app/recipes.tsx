import type { FoodItemV1, MealSlotV1, RecipeV1 } from "@healthapp/api/v1";
import { checkRecipeSteps, recipeStepsFromText } from "@healthapp/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, NavIcon, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";
import { useConfirmLeave } from "@/lib/unsaved";

// My recipes — the web's /recipes on a phone (components/recipes.tsx and the
// new-recipe dialog): each recipe's serving and lines, its preparation (read
// and edit), "add n servings to the diary", delete; and New recipe from foods
// in grams. The DishFinder hand-off lands on the web (a signed form post).

const SLOTS: MealSlotV1[] = ["breakfast", "lunch", "dinner", "snack"];

export default function Recipes() {
  const { t } = useI18n();
  const { color } = useTheme();
  const m = t.clientApp.recipes;
  const query = useQuery({ queryKey: ["recipes"], queryFn: api.recipes });
  const [creating, setCreating] = useState(false);
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.common.nav.nutrition} />
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T kind="title">{m.title}</T>
            <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{m.intro}</Text>
          </View>
        </View>
        {creating ? <NewRecipe onDone={() => setCreating(false)} /> : <View style={{ alignSelf: "flex-start" }}><Button height={40} label={m.create.button} onPress={() => setCreating(true)} /></View>}
        {!query.data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : query.data.length === 0 ? (
          <Card style={{ gap: 4 }}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{m.empty}</Text>
            <T kind="soft" style={{ lineHeight: 19 }}>{m.emptyHint}</T>
          </Card>
        ) : (
          query.data.map((r) => <RecipeCard key={r.id} recipe={r} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function useRecipeWrite() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function write(op: string, body: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
    setBusy(true);
    try {
      const r = await api.recipeWrite(op, body);
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      if (op === "log") void queryClient.invalidateQueries({ queryKey: ["food"] });
      return r;
    } catch (e) {
      return { ok: false, message: e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : t.clientApp.recipes.failed };
    } finally {
      setBusy(false);
    }
  }
  return { write, busy };
}

function RecipeCard({ recipe }: { recipe: RecipeV1 }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const m = t.clientApp.recipes;
  const f = t.clientApp.food as unknown as Record<string, string>;
  const { write, busy } = useRecipeWrite();
  const [servings, setServings] = useState("1");
  const [slot, setSlot] = useState<MealSlotV1>("lunch");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const s = recipe.per_serving;

  async function log() {
    const n = Number(servings.replace(",", "."));
    if (!(n > 0 && n <= 20)) return setStatus({ ok: false, text: fill(m.servingsRange, { max: 20 }) });
    const r = await write("log", { input: { recipeId: recipe.id, servings: n, slot, day: null } });
    setStatus(r.ok ? { ok: true, text: m.logged } : { ok: false, text: r.message ?? m.failed });
  }

  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        {recipe.image_url ? <Image source={{ uri: recipe.image_url }} style={styles.thumb} /> : null}
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{recipe.title}</Text>
          <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>
            <Text style={{ fontFamily: font.semibold, color: color.ink }}>{`${s.kcal} kcal`}</Text>
            {` · P ${s.protein} g · C ${s.carbs} g · G ${s.fat} g ${m.perServing}`}
          </Text>
          <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>
            {`${fill(m.servingWeight, { grams: recipe.serving_grams })} · ${fill(m.madeOf, { servings: recipe.servings })} · ${!recipe.dishfinder_url ? m.ownRecipe : recipe.nutrition_source === "voinic" ? m.adjusted : m.fromDishfinder}`}
          </Text>
          {recipe.dishfinder_url ? (
            <Text accessibilityRole="link" onPress={() => void Linking.openURL(recipe.dishfinder_url!)} style={{ fontFamily: font.semibold, fontSize: 12, color: color.accentInk }}>{`${m.openDishfinder} ↗`}</Text>
          ) : null}
        </View>
      </View>

      {recipe.lines.length > 0 ? (
        <View>
          <Text accessibilityRole="button" onPress={() => setOpen((v) => !v)} style={styles.toggle(color.inkFaint)}>{`${m.ingredients} (${recipe.lines.length}) ${open ? "▴" : "▾"}`}</Text>
          {open ? recipe.lines.map((l, i) => (
            <Text key={i} style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>
              {l.label}
              {l.food_name ? <Text style={{ color: color.inkFaint }}>{` → ${l.food_name}`}</Text> : null}
            </Text>
          )) : null}
        </View>
      ) : null}

      <Preparation recipe={recipe} />

      <View style={[styles.log, { backgroundColor: color.bg }]}>
        <View style={{ gap: 4 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: color.inkSoft }}>{m.servings}</Text>
          <TextInput value={servings} onChangeText={setServings} keyboardType="decimal-pad" accessibilityLabel={m.servings} style={[styles.small, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }]} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: color.inkSoft }}>{m.slot}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
            {SLOTS.map((x) => (
              <Pressable key={x} accessibilityRole="radio" accessibilityState={{ checked: x === slot }} onPress={() => setSlot(x)} style={[styles.chip, { backgroundColor: x === slot ? color.accent : color.surface }]}>
                <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: x === slot ? color.accentFg : color.inkSoft }}>{f[x]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
      <View style={{ alignSelf: "flex-start" }}>
        <Button height={38} label={busy ? m.logging : m.log} busy={busy} onPress={() => void log()} />
      </View>
      {status ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: status.ok ? color.accentInk : color.risk }}>{status.text}</Text> : null}

      <View style={{ alignItems: "flex-end" }}>
        {confirming ? (
          <View style={{ gap: 6, alignItems: "flex-end" }}>
            <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkSoft }}>{m.removeConfirm}</Text>
            <View style={{ flexDirection: "row", gap: 14 }}>
              <Text accessibilityRole="button" onPress={busy ? undefined : async () => { const r = await write("delete", { id: recipe.id }); if (!r.ok) setStatus({ ok: false, text: r.message ?? m.failed }); }} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{m.removeYes}</Text>
              <Text accessibilityRole="button" onPress={() => setConfirming(false)} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{m.cancel}</Text>
            </View>
          </View>
        ) : (
          <Text accessibilityRole="button" onPress={() => setConfirming(true)} style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkFaint }}>{m.remove}</Text>
        )}
      </View>
    </Card>
  );
}

/** The preparation: numbered steps and the two times, folded; the owner edits them. */
function Preparation({ recipe }: { recipe: RecipeV1 }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const m = t.clientApp.recipes;
  const { write, busy } = useRecipeWrite();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [prep, setPrep] = useState("");
  const [cook, setCook] = useState("");
  const [error, setError] = useState<string | null>(null);
  const times = [
    recipe.prep_minutes !== null ? fill(m.prepTime, { n: recipe.prep_minutes }) : null,
    recipe.cook_minutes !== null ? fill(m.cookTime, { n: recipe.cook_minutes }) : null,
  ].filter(Boolean).join(" · ");
  const minutes = (v: string): number | null | undefined => {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 1440 ? n : undefined;
  };
  function edit() {
    setText(recipe.steps.join("\n"));
    setPrep(recipe.prep_minutes === null ? "" : String(recipe.prep_minutes));
    setCook(recipe.cook_minutes === null ? "" : String(recipe.cook_minutes));
    setError(null);
    setEditing(true);
    setOpen(true);
  }
  async function save() {
    const steps = recipeStepsFromText(text);
    const prepMinutes = minutes(prep);
    const cookMinutes = minutes(cook);
    if (checkRecipeSteps(steps) !== "ok" || prepMinutes === undefined || cookMinutes === undefined) return setError(m.tooManySteps);
    const r = await write("prep", { input: { recipeId: recipe.id, steps, prepMinutes, cookMinutes } });
    if (r.ok) setEditing(false);
    else setError(r.message ?? m.failed);
  }
  return (
    <View style={{ gap: 6 }}>
      <Text accessibilityRole="button" onPress={() => setOpen((v) => !v)} style={styles.toggle(color.inkFaint)}>
        {`${m.preparation}${recipe.steps.length ? ` (${recipe.steps.length})` : ""} ${open ? "▴" : "▾"}`}
        {times ? <Text style={{ fontFamily: font.regular, textTransform: "none", letterSpacing: 0 }}>{`   ${times}`}</Text> : null}
      </Text>
      {open && !editing ? (
        recipe.steps.length > 0 ? (
          <>
            {recipe.steps.map((step, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 8 }}>
                <Text style={{ width: 18, fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{`${i + 1}.`}</Text>
                <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.inkSoft }}>{step}</Text>
              </View>
            ))}
            <Text accessibilityRole="button" onPress={edit} style={{ fontFamily: font.semibold, fontSize: 12, color: color.accentInk }}>{m.editSteps}</Text>
          </>
        ) : (
          <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
            {`${m.noSteps} `}
            <Text accessibilityRole="button" onPress={edit} style={{ fontFamily: font.semibold, color: color.accentInk }}>{m.addSteps}</Text>
          </Text>
        )
      ) : null}
      {open && editing ? (
        <View style={[styles.editor, { backgroundColor: color.bg }]}>
          <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: color.inkSoft }}>{m.stepsLabel}</Text>
          <TextInput value={text} onChangeText={setText} multiline placeholder={m.stepsPlaceholder} placeholderTextColor={color.inkFaint} accessibilityLabel={m.stepsLabel} style={[styles.area, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }]} />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: color.inkSoft }}>{m.prepMinutes}</Text>
              <TextInput value={prep} onChangeText={setPrep} keyboardType="number-pad" accessibilityLabel={m.prepMinutes} style={[styles.small, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }]} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: color.inkSoft }}>{m.cookMinutes}</Text>
              <TextInput value={cook} onChangeText={setCook} keyboardType="number-pad" accessibilityLabel={m.cookMinutes} style={[styles.small, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }]} />
            </View>
          </View>
          <T kind="faint">{m.stepsHint}</T>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Button height={38} label={busy ? m.savingSteps : m.saveSteps} busy={busy} onPress={() => void save()} />
            <Text accessibilityRole="button" onPress={() => setEditing(false)} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{m.cancel}</Text>
          </View>
          {error ? <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.risk }}>{error}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

type Line = { food: FoodItemV1; grams: string };

/** A new recipe (recipe-editor-dialog.tsx): name, servings, foods in grams, the steps. Nutrition is worked out on the server. */
function NewRecipe({ onDone }: { onDone: () => void }) {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const m = t.clientApp.recipes.create;
  const im = t.clientApp.recipes.import;
  const r = t.clientApp.recipes;
  const { write, busy } = useRecipeWrite();
  const [title, setTitle] = useState("");
  const [servings, setServings] = useState("4");
  const [servingGrams, setServingGrams] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [steps, setSteps] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(h);
  }, [typed]);
  const search = useQuery({ queryKey: ["foods", q], queryFn: () => api.searchFoods(q), enabled: q.length >= 2 });
  const name = (food: FoodItemV1) => (locale === "ro" ? food.name_ro : food.name_en);
  // Back with a half-written recipe asks first instead of dropping it
  useConfirmLeave(Boolean(title.trim() || lines.length > 0 || steps.trim() || servingGrams.trim()) && !busy);

  async function save() {
    const n = Number(servings.replace(",", "."));
    if (!title.trim()) return setError(m.titleRequired);
    if (!(n > 0 && n <= 500)) return setError(m.servingsRequired);
    if (lines.length === 0) return setError(m.linesRequired);
    const grams = lines.map((l) => Number(l.grams.replace(",", ".")));
    if (grams.some((g) => !(g > 0))) return setError(m.gramsRequired);
    const g = servingGrams.trim() ? Number(servingGrams.replace(",", ".")) : null;
    if (g !== null && !(g > 0)) return setError(im.servingGramsRequired);
    setError(null);
    const res = await write("create", {
      input: { title: title.trim(), servings: n, servingGrams: g, lines: lines.map((l, i) => ({ foodId: l.food.id, grams: grams[i] })), steps: recipeStepsFromText(steps), prepMinutes: null, cookMinutes: null },
    });
    if (!res.ok) return setError(res.message === "RECIPE_LIMIT" ? m.limit : res.message ?? r.failed);
    onDone();
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{m.title}</Text>
      <T kind="soft">{m.lead}</T>
      <TextInput value={title} onChangeText={setTitle} maxLength={160} placeholder={m.namePlaceholder} placeholderTextColor={color.inkFaint} accessibilityLabel={m.name} style={[styles.field, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: color.inkSoft }}>{`${im.servings} (${im.servingsUnit})`}</Text>
          <TextInput value={servings} onChangeText={setServings} keyboardType="decimal-pad" accessibilityLabel={im.servings} style={[styles.small, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: color.inkSoft }}>{`${im.servingGrams} (${m.optional})`}</Text>
          <TextInput value={servingGrams} onChangeText={setServingGrams} keyboardType="decimal-pad" accessibilityLabel={im.servingGrams} style={[styles.small, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]} />
        </View>
      </View>
      <T kind="label">{im.ingredients}</T>
      {lines.length === 0 ? <T kind="faint">{m.noLines}</T> : null}
      {lines.map((l, i) => (
        <View key={`${l.food.id}-${i}`} style={[styles.line, { backgroundColor: color.bg }]}>
          <Text numberOfLines={2} style={{ flex: 1, fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{name(l.food)}</Text>
          <TextInput value={l.grams} onChangeText={(v) => setLines((x) => x.map((y, j) => (j === i ? { ...y, grams: v } : y)))} keyboardType="decimal-pad" accessibilityLabel={`${name(l.food)} ${im.grams}`} style={[styles.grams, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }]} />
          <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>g</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={im.remove} onPress={() => setLines((x) => x.filter((_, j) => j !== i))} hitSlop={6} style={{ padding: 4 }}>
            <NavIcon d="M6 6 18 18M18 6 6 18" size={15} color={color.risk} />
          </Pressable>
        </View>
      ))}
      <TextInput value={typed} onChangeText={setTyped} autoCorrect={false} placeholder={im.searchPlaceholder} placeholderTextColor={color.inkFaint} accessibilityLabel={m.addLine} style={[styles.field, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]} />
      {search.data && search.data.length === 0 ? <T kind="faint">{im.noResults}</T> : null}
      {(q.length >= 2 ? search.data ?? [] : []).slice(0, 8).map((food) => (
        <Pressable key={food.id} accessibilityRole="button" onPress={() => { setLines((x) => [...x, { food, grams: "100" }]); setTyped(""); }} style={[styles.hit, { backgroundColor: color.bg }]}>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.regular, fontSize: 13, color: color.ink }}>{name(food)}</Text>
          <Text style={{ fontFamily: font.bold, fontSize: 12.5, color: color.accentInk }}>{`+ ${m.addLine}`}</Text>
        </Pressable>
      ))}
      <T kind="label">{r.preparation}</T>
      <TextInput value={steps} onChangeText={setSteps} multiline placeholder={r.stepsPlaceholder} placeholderTextColor={color.inkFaint} accessibilityLabel={r.stepsLabel} style={[styles.area, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Button height={42} label={busy ? im.saving : im.save} busy={busy} onPress={() => void save()} />
        <Text accessibilityRole="button" onPress={onDone} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{r.cancel}</Text>
      </View>
      {error ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
    </Card>
  );
}

const styles = {
  ...StyleSheet.create({
    body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
    thumb: { width: 64, height: 64, borderRadius: 12 },
    log: { flexDirection: "row", gap: 12, borderRadius: 16, padding: 12 },
    small: { height: 40, minWidth: 70, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, fontFamily: font.semibold, fontSize: 14 },
    chip: { height: 30, borderRadius: 15, paddingHorizontal: 10, justifyContent: "center" },
    editor: { gap: 8, borderRadius: 16, padding: 12 },
    area: { minHeight: 110, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, textAlignVertical: "top", fontFamily: font.regular, fontSize: 13.5 },
    field: { height: 46, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, fontFamily: font.regular, fontSize: 14 },
    line: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
    grams: { width: 64, height: 36, borderRadius: 10, borderWidth: 1, textAlign: "center", fontFamily: font.semibold, fontSize: 13.5 },
    hit: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  }),
  toggle: (ink: string) => ({ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" as const, color: ink }),
};
