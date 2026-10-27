import type { MyFoodV1 } from "@healthapp/api/v1";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NewFoodForm } from "@/components/new-food-form";
import { Card, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// My foods — the web's /food/mine on a phone: the foods the person created
// (from a search or a barcode miss), each with Edit (the creation form, filled
// in) and Delete; new ones can be made here too. What was already logged keeps
// its numbers (food_logs snapshots macros at log time).

export default function MyFoods() {
  const { t } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const m = t.clientApp.myFoods;
  const query = useQuery({ queryKey: ["my-foods"], queryFn: api.myFoods });
  const [creating, setCreating] = useState(false);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["my-foods"] });
    void queryClient.invalidateQueries({ queryKey: ["food-search"] });
  };
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}>
        <BackHeader label={t.common.nav.nutrition} />
        <T kind="title">{m.title}</T>
        <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{m.intro}</Text>
        {creating ? (
          <NewFoodForm onCreated={() => { setCreating(false); refresh(); }} onCancel={() => setCreating(false)} />
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setCreating(true)} style={[styles.new, { backgroundColor: color.accent }]}>
            <Text style={{ fontFamily: font.bold, fontSize: 13, color: color.accentFg }}>{`+ ${m.newFood}`}</Text>
          </Pressable>
        )}
        {!query.data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 24 }} />
        ) : query.data.length === 0 ? (
          <Card style={{ alignItems: "center", paddingVertical: 28 }}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink, textAlign: "center" }}>{m.empty}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft, textAlign: "center" }}>{m.emptyHint}</Text>
          </Card>
        ) : (
          query.data.map((food) => <Row key={food.id} food={food} onChanged={refresh} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ food, onChanged }: { food: MyFoodV1; onChanged: () => void }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const m = t.clientApp.myFoods;
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = food.per_100g;

  async function remove() {
    setError(null);
    setPending(true);
    try {
      const r = await api.myFoodWrite("delete", { id: food.id });
      if (r.ok) onChanged();
      else {
        setConfirming(false);
        setError(r.message ?? m.failed);
      }
    } catch {
      setError(m.failed);
    } finally {
      setPending(false);
    }
  }

  if (editing) return <NewFoodForm editing={food} onCreated={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />;
  return (
    <Card style={{ gap: 4 }}>
      <Text style={{ fontFamily: font.displayBold, fontSize: 16, color: color.ink }}>{food.name}</Text>
      {food.brand ? <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{food.brand}</Text> : null}
      <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>
        <Text style={{ fontFamily: font.semibold, color: color.ink }}>{`${p.kcal} kcal`}</Text>
        {` · P ${p.protein} g · C ${p.carbs} g · G ${p.fat} g ${m.per100g}`}
      </Text>
      {food.portions.length > 0 || food.barcode ? (
        <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>
          {[food.portions.map((x) => `${x.label} = ${x.grams} g`).join(" · "), food.barcode ? `${m.barcode} ${food.barcode}` : ""].filter(Boolean).join(" · ")}
        </Text>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={{ marginTop: 4, fontFamily: font.regular, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
      <View style={{ marginTop: 8, flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: 14 }}>
        {confirming ? (
          <>
            <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>{m.removeConfirm}</Text>
            <Text accessibilityRole="button" onPress={pending ? undefined : () => void remove()} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{m.removeYes}</Text>
            <Text accessibilityRole="button" onPress={() => setConfirming(false)} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{t.common.actions.cancel}</Text>
          </>
        ) : (
          <>
            <Text accessibilityRole="button" onPress={() => setEditing(true)} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{m.edit}</Text>
            <Text accessibilityRole="button" onPress={() => setConfirming(true)} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{m.remove}</Text>
          </>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 12 },
  new: { alignSelf: "flex-start", height: 40, borderRadius: 12, paddingHorizontal: 16, justifyContent: "center" },
});
