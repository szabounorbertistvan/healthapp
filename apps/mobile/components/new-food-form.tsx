import type { FoodItemV1, MyFoodV1 } from "@healthapp/api/v1";
import { parseDecimal } from "@healthapp/shared";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// Create a food the search does not have — the web's NewFoodForm
// (components/new-food-form.tsx): a name and the four numbers per 100 g, and,
// folded away unless a scan brought the person here, what else the label says,
// the barcode and their own servings. With `editing` it is the same form over
// one of their own foods. The server checks every number.

/** foods.portions holds at most 8 (is_valid_food_portions). */
const MAX_PORTIONS = 8;

type PortionDraft = { label: string; grams: string };

export function NewFoodForm({ initialName = "", initialBarcode = "", primaryLabel, editing, onCreated, onCancel }: {
  initialName?: string;
  /** The code a scan missed: saved with the food so the next scan finds it. */
  initialBarcode?: string;
  primaryLabel?: string;
  editing?: MyFoodV1;
  onCreated: (food: FoodItemV1) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const { color } = useTheme();
  const m = t.clientWidgets.newFoodForm;
  const shown = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  const [name, setName] = useState(editing?.name ?? initialName);
  const [brand, setBrand] = useState(editing?.brand ?? "");
  const [kcal, setKcal] = useState(shown(editing?.per_100g.kcal));
  const [protein, setProtein] = useState(shown(editing?.per_100g.protein));
  const [carbs, setCarbs] = useState(shown(editing?.per_100g.carbs));
  const [fat, setFat] = useState(shown(editing?.per_100g.fat));
  const [saturated, setSaturated] = useState(shown(editing?.saturatedFat));
  const [sugar, setSugar] = useState(shown(editing?.sugar));
  const [salt, setSalt] = useState(shown(editing?.salt));
  const [barcode, setBarcode] = useState(editing?.barcode ?? initialBarcode);
  const [portions, setPortions] = useState<PortionDraft[]>(editing?.portions.map((p) => ({ label: p.label, grams: String(p.grams) })) ?? []);
  const [more, setMore] = useState(
    initialBarcode !== "" || (editing !== undefined && (editing.saturatedFat !== null || editing.sugar !== null || editing.salt !== null || editing.barcode !== null || editing.portions.length > 0)),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // blank is "not given" (0 for a macro, null for a label nutrient); "60,5" is how a Romanian keyboard types 60.5
  const given = (v: string) => v.trim() !== "";
  const parses = (v: string) => !given(v) || parseDecimal(v) !== null;
  const macro = (v: string) => (given(v) ? parseDecimal(v) ?? NaN : 0);
  const nutrient = (v: string) => (given(v) ? parseDecimal(v) ?? NaN : null);
  const valid = name.trim().length >= 2 && given(kcal) && [kcal, protein, carbs, fat, saturated, sugar, salt].every(parses);

  async function submit() {
    if (!valid) return;
    setError(null);
    setPending(true);
    try {
      const input = {
        name, brand, kcal: macro(kcal), protein: macro(protein), carbs: macro(carbs), fat: macro(fat),
        saturatedFat: nutrient(saturated), sugar: nutrient(sugar), salt: nutrient(salt), barcode: barcode.trim() || null,
        portions: portions.filter((p) => given(p.label) || given(p.grams)).map((p) => ({ label: p.label, grams: parseDecimal(p.grams) ?? NaN })),
      };
      const r = editing ? await api.myFoodWrite("update", { id: editing.id, input }) : await api.myFoodWrite("create", { input });
      if (!r.ok || !r.food) return setError(r.message || m.couldNotCreate);
      onCreated(r.food);
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : m.couldNotCreate);
    } finally {
      setPending(false);
    }
  }

  const input = [styles.input, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }];
  const field = (label: string, value: string, set: (v: string) => void, placeholder = "0") => (
    <View style={{ flexBasis: "46%", flexGrow: 1, gap: 4 }}>
      <Text style={styles.label(color.inkFaint)}>{label}</Text>
      <TextInput value={value} onChangeText={set} keyboardType="decimal-pad" placeholder={placeholder} placeholderTextColor={color.inkFaint} accessibilityLabel={label} style={input} />
    </View>
  );
  const setPortion = (i: number, patch: Partial<PortionDraft>) => setPortions((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <View style={[styles.box, { backgroundColor: color.bg }]}>
      <View>
        <Text style={{ fontFamily: font.bold, fontSize: 14, color: color.ink }}>{editing ? m.editTitle : m.title}</Text>
        <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.inkFaint }}>{m.body}</Text>
      </View>
      <View style={{ gap: 4 }}>
        <Text style={styles.label(color.inkFaint)}>{m.name}</Text>
        <TextInput autoFocus value={name} onChangeText={setName} placeholder={m.namePlaceholder} placeholderTextColor={color.inkFaint} accessibilityLabel={m.name} style={input} />
      </View>
      <View style={{ gap: 4 }}>
        <Text style={styles.label(color.inkFaint)}>{m.brand}</Text>
        <TextInput value={brand} onChangeText={setBrand} accessibilityLabel={m.brand} style={input} />
      </View>
      <View style={styles.grid}>
        {field(m.kcal, kcal, setKcal)}
        {field(m.protein, protein, setProtein)}
        {field(m.carbs, carbs, setCarbs)}
        {field(m.fat, fat, setFat)}
      </View>

      <View style={{ borderRadius: 12, borderWidth: 1, borderColor: color.line, paddingHorizontal: 12, paddingVertical: 8, gap: 12 }}>
        <Text accessibilityRole="button" accessibilityState={{ expanded: more }} onPress={() => setMore((v) => !v)} style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkSoft }}>
          {`${more ? "▾" : "▸"} ${m.more}`}
        </Text>
        {more ? (
          <>
            <View style={styles.grid}>
              {field(m.saturatedFat, saturated, setSaturated, "")}
              {field(m.sugar, sugar, setSugar, "")}
              {field(m.salt, salt, setSalt, "")}
            </View>
            <View style={{ gap: 4 }}>
              <Text style={styles.label(color.inkFaint)}>{m.barcode}</Text>
              <TextInput value={barcode} onChangeText={setBarcode} keyboardType="number-pad" accessibilityLabel={m.barcode} style={input} />
              <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{m.barcodeHint}</Text>
            </View>
            <View style={{ gap: 6 }}>
              <Text style={styles.label(color.inkFaint)}>{m.portions}</Text>
              <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{m.portionsHint}</Text>
              {portions.map((p, i) => (
                <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <TextInput value={p.label} maxLength={16} onChangeText={(v) => setPortion(i, { label: v })} placeholder={m.portionLabelPlaceholder} placeholderTextColor={color.inkFaint}
                    accessibilityLabel={m.portionLabel} style={[input, { flex: 1 }]} />
                  <TextInput value={p.grams} keyboardType="decimal-pad" onChangeText={(v) => setPortion(i, { grams: v })} placeholder="g" placeholderTextColor={color.inkFaint}
                    accessibilityLabel={m.portionGrams} style={[input, { width: 88 }]} />
                  <Pressable accessibilityRole="button" accessibilityLabel={m.removePortion} onPress={() => setPortions((list) => list.filter((_, j) => j !== i))} style={{ width: 36, height: 44, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 18, color: color.inkFaint }}>×</Text>
                  </Pressable>
                </View>
              ))}
              {portions.length < MAX_PORTIONS ? (
                <Text accessibilityRole="button" onPress={() => setPortions((list) => [...list, { label: "", grams: "" }])} style={{ fontFamily: font.semibold, fontSize: 12, color: color.accentInk }}>{`+ ${m.addPortion}`}</Text>
              ) : null}
            </View>
          </>
        ) : null}
      </View>

      {error ? <Text accessibilityRole="alert" style={{ fontFamily: font.semibold, fontSize: 13, color: color.risk }}>{error}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Pressable accessibilityRole="button" disabled={pending || !valid} onPress={() => void submit()} style={[styles.primary, { backgroundColor: color.accent, opacity: pending || !valid ? 0.4 : 1 }]}>
          {pending ? <ActivityIndicator color={color.accentFg} /> : <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.accentFg }}>{primaryLabel ?? m.save}</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" disabled={pending} onPress={onCancel} style={[styles.primary, { paddingHorizontal: 12 }]}>
          <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.inkFaint }}>{t.common.actions.cancel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = {
  ...StyleSheet.create({
    box: { borderRadius: 16, padding: 14, gap: 12 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    input: { height: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontFamily: font.regular, fontSize: 14 },
    primary: { minHeight: 44, borderRadius: 10, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  }),
  label: (ink: string) => ({ fontFamily: font.semibold, fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase" as const, color: ink }),
};
