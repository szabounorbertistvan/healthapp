import type { FoodItemV1, MacrosV1, MealSlotV1, QuickFoodV1 } from "@healthapp/api/v1";
import { isValidPortionGrams, MAX_PORTION_GRAMS, portionMacros } from "@healthapp/shared";
import { useQuery } from "@tanstack/react-query";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Screen, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { foodName } from "@/lib/food-model";
import { useI18n } from "@/lib/i18n";
import { parseDecimal } from "@/lib/logger-model";
import { useOfflineQuery } from "@/lib/offline-query";
import { useOutbox } from "@/lib/outbox";
import { fontSize, minTouchTarget, radius, space, useTheme } from "@/lib/theme";

// Add a food to one meal of one day: search, the person's recent and favourite
// foods, or a barcode — then the portion. The scanner is the web's rule: a miss
// always falls through to search, never a dead end.

type Picked = { id: string | null; name: string; per100g: MacrosV1; portions: { label: string; grams: number }[]; grams: number | null };

export default function AddFood() {
  const { slot, day } = useLocalSearchParams<{ slot: MealSlotV1; day: string }>();
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(timer);
  }, [term]);

  const search = useQuery({
    queryKey: ["food-search", debounced],
    queryFn: () => api.searchFoods(debounced),
    enabled: debounced.length >= 2,
    staleTime: 5 * 60_000,
    retry: false,
  });
  // The recent / favourite foods come with the diary day, which the phone keeps.
  const foodDay = useOfflineQuery(`food:${day}`, ["food", day], () => api.foodDay(day));
  const quick = foodDay.data?.data.quick;

  const slotName = t.clientWidgets.foodLogger.slots[slot as MealSlotV1] ?? slot;
  const fromItem = (f: FoodItemV1): Picked => ({ id: f.id, name: foodName(f, locale), per100g: f.per_100g, portions: f.portions, grams: null });

  if (picked) {
    return <Portion picked={picked} slot={slot} day={day} onBack={() => setPicked(null)} />;
  }
  if (scanning) {
    return (
      <Scanner
        onCancel={() => setScanning(false)}
        onResult={(result, code) => {
          setScanning(false);
          if (result) setPicked(fromItem(result));
          else {
            setScanNote(code);
            setTerm("");
          }
        }}
      />
    );
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <BackHeader label={t.mobile.tabs.food} />
          <T kind="title">{fill(t.mobile.food.addTitle, { slot: slotName })}</T>
          <View style={styles.searchRow}>
            <TextInput
              accessibilityLabel={t.clientWidgets.foodLogger.searchPlaceholder}
              placeholder={t.clientWidgets.foodLogger.searchPlaceholder}
              placeholderTextColor={color.inkFaint}
              value={term}
              onChangeText={setTerm}
              autoFocus
              autoCorrect={false}
              style={[styles.field, { flex: 1, color: color.ink, backgroundColor: color.surface, borderColor: color.line }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.clientWidgets.foodLogger.scanBarcode}
              onPress={() => {
                setScanNote(null);
                setScanning(true);
              }}
              style={[styles.scan, { backgroundColor: color.accent }]}
            >
              <T style={{ color: color.accentFg, fontWeight: "700" }}>{t.clientWidgets.foodLogger.scan}</T>
            </Pressable>
          </View>
          {scanNote ? <T kind="soft">{scanNote}</T> : null}

          {debounced.length >= 2 ? (
            search.isFetching ? (
              <ActivityIndicator color={color.accent} />
            ) : search.isError ? (
              <T kind="soft">{t.mobile.food.needsSignal}</T>
            ) : (search.data ?? []).length === 0 ? (
              <T kind="soft">{t.clientWidgets.foodLogger.noMatches}</T>
            ) : (
              <Card>
                {(search.data ?? []).map((f) => (
                  <FoodRow
                    key={f.id}
                    name={foodName(f, locale)}
                    detail={[f.brand, `${Math.round(f.per_100g.kcal)} ${t.mobile.food.kcal} / 100 g`].filter(Boolean).join(" · ")}
                    badge={f.english_only ? t.clientWidgets.foodLogger.englishOnly : null}
                    onPress={() => setPicked(fromItem(f))}
                  />
                ))}
              </Card>
            )
          ) : (
            <>
              <T kind="faint">{t.mobile.food.searchHint}</T>
              {quick && quick.favorites.length > 0 ? <QuickList title={t.clientWidgets.foodLogger.favorites} foods={quick.favorites} onPick={setPicked} /> : null}
              {quick && quick.recent.length > 0 ? <QuickList title={t.clientWidgets.foodLogger.recent} foods={quick.recent} onPick={setPicked} /> : null}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function QuickList({ title, foods, onPick }: { title: string; foods: QuickFoodV1[]; onPick: (p: Picked) => void }) {
  const { t } = useI18n();
  return (
    <Card>
      <T kind="faint">{title}</T>
      {foods.map((f) => (
        <FoodRow
          key={`${f.food_id ?? f.name}`}
          name={f.name}
          detail={`${Math.round(f.per_100g.kcal)} ${t.mobile.food.kcal} / 100 g${f.last_grams ? ` · ${Math.round(f.last_grams)} g` : ""}`}
          badge={null}
          onPress={() => onPick({ id: f.food_id, name: f.name, per100g: f.per_100g, portions: f.portions, grams: f.last_grams })}
        />
      ))}
    </Card>
  );
}

function FoodRow({ name, detail, badge, onPress }: { name: string; detail: string; badge: string | null; onPress: () => void }) {
  const { color } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? color.accentSoft : "transparent" }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <T style={{ fontWeight: "600" }}>{name}</T>
        <T kind="faint">{detail}</T>
      </View>
      {badge ? <T kind="faint">{badge}</T> : null}
    </Pressable>
  );
}

function Portion({ picked, slot, day, onBack }: { picked: Picked; slot: MealSlotV1; day: string; onBack: () => void }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const outbox = useOutbox();
  const [grams, setGrams] = useState(picked.grams ? String(Math.round(picked.grams)) : picked.portions[0] ? String(picked.portions[0].grams) : "100");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = parseDecimal(grams);
  const macros = isValidPortionGrams(value) ? portionMacros(picked.per100g, value) : null;
  const p = picked.per100g;

  async function add() {
    if (!isValidPortionGrams(value)) return setError(fill(t.clientWidgets.foodLogger.gramsRange, { max: MAX_PORTION_GRAMS }));
    setBusy(true);
    try {
      // On the phone first; the outbox sends it through the web's logFood().
      const id = randomUUID();
      await outbox.queue({
        kind: "food",
        input: { slot, foodName: picked.name, grams: value, per100g: picked.per100g, foodId: picked.id, day, clientId: id },
      });
      router.back();
    } catch {
      setError(t.clientWidgets.foodLogger.couldNotLog);
      setBusy(false);
    }
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Pressable accessibilityRole="button" onPress={onBack} style={{ minHeight: minTouchTarget, justifyContent: "center" }}>
            <T kind="faint">{`‹  ${t.mobile.food.cancel}`}</T>
          </Pressable>
          <T kind="title">{picked.name}</T>
          <T kind="faint">
            {fill(t.mobile.food.per100, { kcal: Math.round(p.kcal), protein: Math.round(p.protein), carbs: Math.round(p.carbs), fat: Math.round(p.fat) })}
          </T>
          {picked.portions.length > 0 ? (
            <View style={styles.chips}>
              {picked.portions.map((portion) => (
                <Pressable
                  key={`${portion.label}:${portion.grams}`}
                  accessibilityRole="button"
                  onPress={() => setGrams(String(portion.grams))}
                  style={[styles.chip, { borderColor: String(portion.grams) === grams ? color.accent : color.line }]}
                >
                  <T>{`${portion.label} · ${Math.round(portion.grams)} g`}</T>
                </Pressable>
              ))}
            </View>
          ) : null}
          <T kind="faint">{t.clientWidgets.foodLogger.grams}</T>
          <TextInput
            accessibilityLabel={t.clientWidgets.foodLogger.grams}
            value={grams}
            onChangeText={setGrams}
            keyboardType="decimal-pad"
            selectTextOnFocus
            style={[styles.field, { color: color.ink, backgroundColor: color.surface, borderColor: color.line, fontSize: fontSize.xl }]}
          />
          {macros ? (
            <T kind="soft">
              {fill(t.mobile.food.willAdd, { grams: value, kcal: macros.kcal, protein: macros.protein, carbs: macros.carbs, fat: macros.fat })}
            </T>
          ) : null}
          {error ? <T style={{ color: color.risk }}>{error}</T> : null}
          <Button
            label={fill(t.clientWidgets.foodLogger.addTo, { slot: t.clientWidgets.foodLogger.slots[slot] ?? slot })}
            busy={busy}
            onPress={() => void add()}
          />
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function Scanner({ onCancel, onResult }: { onCancel: () => void; onResult: (food: FoodItemV1 | null, note: string) => void }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [looking, setLooking] = useState<string | null>(null);
  const handled = useRef(false);

  async function onScan(scan: BarcodeScanningResult) {
    if (handled.current) return;
    const code = scan.data.trim();
    if (!/^\d{6,14}$/.test(code)) return;
    handled.current = true;
    setLooking(code);
    try {
      const result = await api.barcode(code);
      if (result.ok) return onResult(result.food, "");
      if (result.reason === "limit") return onResult(null, t.mobile.food.scanLimit);
      if (result.reason === "upstream") return onResult(null, t.clientWidgets.foodLogger.scanUnreachable);
      return onResult(null, fill(t.mobile.food.notFound, { code }));
    } catch {
      return onResult(null, t.clientWidgets.foodLogger.scanUnreachable);
    }
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1, padding: space.lg, gap: space.md }}>
        <Pressable accessibilityRole="button" onPress={onCancel} style={{ minHeight: minTouchTarget, justifyContent: "center" }}>
          <T kind="faint">{`‹  ${t.mobile.food.cancel}`}</T>
        </Pressable>
        <T kind="title">{t.clientWidgets.foodLogger.scanBarcode}</T>
        {!permission ? (
          <ActivityIndicator color={color.accent} />
        ) : !permission.granted ? (
          <Card>
            <T kind="soft">{t.mobile.food.cameraNeeded}</T>
            <Button label={t.mobile.food.allowCamera} onPress={() => void requestPermission()} />
          </Card>
        ) : (
          <>
            <View style={[styles.camera, { borderColor: color.accent }]}>
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"] }}
                onBarcodeScanned={looking ? undefined : (scan) => void onScan(scan)}
              />
            </View>
            <T kind="soft">{looking ? fill(t.mobile.food.lookingUp, { code: looking }) : t.mobile.food.pointCamera}</T>
          </>
        )}
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  searchRow: { flexDirection: "row", gap: space.sm },
  field: { minHeight: minTouchTarget + 4, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: space.md, fontSize: fontSize.base },
  scan: { minHeight: minTouchTarget + 4, borderRadius: radius.lg, paddingHorizontal: space.lg, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: minTouchTarget + 8, borderRadius: radius.md, paddingHorizontal: space.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: minTouchTarget, justifyContent: "center" },
  camera: { height: 320, borderRadius: radius.xl, overflow: "hidden", borderWidth: 2 },
});
