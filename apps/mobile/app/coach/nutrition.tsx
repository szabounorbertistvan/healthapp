import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The coach's nutrition plans — the web's /nutrition on a phone: every plan
// with its client, status and daily targets, and New plan (/nutrition/new:
// name, client, calories and macros) that opens straight in the plan editor.

export default function CoachNutrition() {
  const { t } = useI18n();
  const { color } = useTheme();
  const n = t.coachApp.nutrition;
  const query = useQuery({ queryKey: ["coach-nutrition"], queryFn: api.coachNutrition });
  const data = query.data;
  const [creating, setCreating] = useState(false);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.common.nav.more} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <T kind="title">{n.title}</T>
          {creating ? null : <Button height={40} label={n.newPlan} onPress={() => setCreating(true)} />}
        </View>
        {!data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : (
          <>
            {creating ? <NewPlan roster={data.roster} onCancel={() => setCreating(false)} /> : null}
            {data.plans.length === 0 ? (
              <Card style={{ gap: 4 }}>
                <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{n.emptyTitle}</Text>
                <T kind="soft">{n.emptyHint}</T>
              </Card>
            ) : (
              data.plans.map((p) => (
                <Pressable key={p.id} accessibilityRole="link" onPress={() => router.push({ pathname: "/coach/plan/[id]", params: { id: p.id } })}>
                  <Card style={{ gap: 10 }}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{p.name}</Text>
                        <Text numberOfLines={1} style={{ marginTop: 2, fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{p.client_name}</Text>
                      </View>
                      <View style={[styles.badge, { backgroundColor: p.status === "published" ? color.accentSoft : color.bg }]}>
                        <Text style={{ fontFamily: font.semibold, fontSize: 11, color: p.status === "published" ? color.accentInk : color.inkFaint }}>{n.status[p.status] ?? p.status}</Text>
                      </View>
                    </View>
                    <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
                      {`${p.kcal_target} ${n.kcal} · ${n.proteinShort} ${p.protein_target_g} · ${n.carbsShort} ${p.carbs_target_g} · ${n.fatShort} ${p.fat_target_g}`}
                    </Text>
                  </Card>
                </Pressable>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** /nutrition/new (NewPlanForm): the four daily targets; the macros' own calories are shown against the target. */
function NewPlan({ roster, onCancel }: { roster: { id: string; name: string }[]; onCancel: () => void }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const m = t.coachWidgets.newPlanForm;
  const [name, setName] = useState("");
  const [client, setClient] = useState(roster[0]?.id ?? "");
  const [v, setV] = useState({ kcal: "2200", protein: "160", carbs: "220", fat: "70" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const num = (s: string) => Number(s.replace(",", "."));
  const fromMacros = Math.round(num(v.protein) * 4 + num(v.carbs) * 4 + num(v.fat) * 9);
  const off = num(v.kcal) > 0 && Math.abs(fromMacros - num(v.kcal)) / num(v.kcal) > 0.05;

  if (roster.length === 0) {
    return (
      <Card style={{ gap: 6 }}>
        <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{t.coachWidgets.noClients.title}</Text>
        <T kind="soft">{t.coachWidgets.noClients.body}</T>
        <Text accessibilityRole="button" onPress={onCancel} style={{ marginTop: 6, fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{t.common.actions.cancel}</Text>
      </Card>
    );
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.coachNutritionWrite("create", {
        name, clientId: client, clientName: roster.find((c) => c.id === client)?.name ?? "—",
        kcal: Math.round(num(v.kcal)), protein: num(v.protein), carbs: num(v.carbs), fat: num(v.fat),
      });
      if (!r.ok || !r.id) return setError(r.message ?? m.createError);
      void queryClient.invalidateQueries({ queryKey: ["coach-nutrition"] });
      router.push({ pathname: "/coach/plan/[id]", params: { id: r.id } });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : m.createError);
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof typeof v, label: string) => (
    <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
      <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase", color: color.inkFaint }}>{label}</Text>
      <TextInput
        value={v[key]}
        onChangeText={(x) => setV((s) => ({ ...s, [key]: x }))}
        keyboardType="decimal-pad"
        accessibilityLabel={label}
        style={[styles.cell, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]}
      />
    </View>
  );

  return (
    <Card style={{ gap: 12 }}>
      <T kind="label">{m.planName}</T>
      <TextInput
        autoFocus
        value={name}
        onChangeText={setName}
        maxLength={120}
        placeholder={m.namePlaceholder}
        placeholderTextColor={color.inkFaint}
        accessibilityLabel={m.planName}
        style={[styles.field, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]}
      />
      <T kind="label">{m.client}</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {roster.map((c) => (
          <Pressable key={c.id} accessibilityRole="radio" accessibilityState={{ checked: c.id === client }} onPress={() => setClient(c.id)} style={[styles.chip, { backgroundColor: c.id === client ? color.accent : color.bg }]}>
            <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: c.id === client ? color.accentFg : color.inkSoft }}>{c.name}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {field("kcal", m.dailyCalories)}
        {field("protein", m.proteinG)}
        {field("carbs", m.carbsG)}
        {field("fat", m.fatG)}
      </View>
      <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: off ? color.warn : color.inkFaint }}>
        {`${fill(m.macrosAddUp, { kcal: fromMacros })}${off ? m.macrosMismatch : ""}`}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Button height={42} label={busy ? m.creating : m.createDraft} busy={busy} disabled={!name.trim() || !client} onPress={() => void create()} />
        <Text accessibilityRole="button" onPress={onCancel} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{t.common.actions.cancel}</Text>
      </View>
      {error ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  field: { height: 46, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, fontFamily: font.regular, fontSize: 14.5 },
  cell: { height: 42, borderRadius: 10, borderWidth: 1, paddingHorizontal: 6, textAlign: "center", fontFamily: font.semibold, fontSize: 14 },
  chip: { minHeight: 34, borderRadius: 17, paddingHorizontal: 13, paddingVertical: 7, justifyContent: "center" },
});
