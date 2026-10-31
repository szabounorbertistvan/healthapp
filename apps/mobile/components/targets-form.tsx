import type { MacrosV1 } from "@healthapp/api/v1";
import { gramsFromSplit, KCAL_PER_GRAM, MACRO_KEYS, rebalanceSplit, splitFromGrams, type MacroKey, type MacroSplit } from "@healthapp/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Button, Card, Slider } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The person's own calorie target and macro split — the web's
// macro-targets-form.tsx: type the calories, move one percentage and the
// other two rebalance so the total stays 100% (packages/shared rebalanceSplit);
// the grams shown are the same formula the server saves with.

export function TargetsForm({ target, planOwner, onClose }: { target: MacrosV1; planOwner: "coach" | "self" | null; onClose: () => void }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const m = t.clientApp.nutritionTargets;
  const labels = t.clientWidgets.macroTargets;
  const [kcal, setKcal] = useState(String(target.kcal > 0 ? Math.round(target.kcal) : 2000));
  const [split, setSplit] = useState<MacroSplit>(() => splitFromGrams(target));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kcalNum = parseInt(kcal, 10);
  const kcalValid = Number.isFinite(kcalNum) && kcalNum >= 500 && kcalNum <= 10000;
  const grams = gramsFromSplit(kcalValid ? kcalNum : 0, split);
  const total = split.protein + split.carbs + split.fat;
  const tones: Record<MacroKey, string> = { protein: color.accent, carbs: color.accentInk, fat: color.warn };

  async function save() {
    // never a silent refusal: the limit is said where the button was tapped
    if (!kcalValid) return setError(m.kcalHint);
    setBusy(true);
    setError(null);
    try {
      const r = await api.saveTargets(kcalNum, split);
      if (!r.ok) return setError(r.message ?? m.couldNotSave);
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["food"] });
      void queryClient.invalidateQueries({ queryKey: ["today"] });
      void queryClient.invalidateQueries({ queryKey: ["meal-plan"] });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : m.couldNotSave);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={styles.kicker(color.inkFaint)}>{m.title}</Text>
        <Text accessibilityRole="button" onPress={onClose} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{t.common.actions.close}</Text>
      </View>
      {planOwner === "coach" ? (
        <View style={[styles.note, { backgroundColor: color.warnSoft }]}><Text style={{ fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.warn }}>{m.coachNote}</Text></View>
      ) : null}
      <View style={{ gap: 4 }}>
        <Text style={styles.kicker(color.inkFaint)}>{m.kcal}</Text>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <TextInput
            value={kcal}
            onChangeText={(v) => { setSaved(false); setKcal(v.replace(/[^\d]/g, "")); }}
            keyboardType="number-pad"
            accessibilityLabel={m.kcal}
            style={[styles.kcal, { color: color.ink, backgroundColor: color.bg, borderColor: kcalValid ? color.line : color.risk }]}
          />
          <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>{`kcal ${m.perDay}`}</Text>
        </View>
        <Text style={{ fontFamily: kcalValid ? font.regular : font.semibold, fontSize: 11, color: kcalValid ? color.inkFaint : color.risk }}>{m.kcalHint}</Text>
      </View>
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={styles.kicker(color.inkFaint)}>{m.split}</Text>
          <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkSoft }}>
            {`${m.total} `}
            <Text style={{ fontFamily: font.bold, color: total === 100 ? color.accentInk : color.risk }}>{`${total}%`}</Text>
          </Text>
        </View>
        <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{m.splitHint}</Text>
      </View>
      {MACRO_KEYS.map((key) => (
        <View key={key} style={{ gap: 2 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.inkSoft }}>
              {labels[key]}
              <Text style={{ fontFamily: font.regular, fontSize: 10.5, color: color.inkFaint }}>{`  ${fill(labels.kcalPerGram, { n: KCAL_PER_GRAM[key] })}`}</Text>
            </Text>
            <Text style={{ fontFamily: font.bold, fontSize: 13.5, color: color.ink }}>
              {`${split[key]}%`}
              <Text style={{ fontFamily: font.regular, color: color.inkFaint }}>{`  ${grams[key]} ${labels.grams}`}</Text>
            </Text>
          </View>
          <Slider min={0} max={100} value={split[key]} label={labels[key]} onChange={(v) => { setSaved(false); setSplit((prev) => rebalanceSplit(prev, key, v)); }} />
        </View>
      ))}
      <View style={[styles.bar, { backgroundColor: color.bg }]}>
        {MACRO_KEYS.map((k) => <View key={k} style={{ width: `${split[k]}%`, backgroundColor: tones[k] }} />)}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Button height={42} label={busy ? t.common.actions.saving : t.common.actions.save} busy={busy} disabled={total !== 100} onPress={() => void save()} />
        {saved ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{m.saved}</Text> : null}
      </View>
      {error ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
    </Card>
  );
}

const styles = {
  ...StyleSheet.create({
    note: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    kcal: { width: 110, height: 46, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontFamily: font.bold, fontSize: 18 },
    bar: { height: 8, borderRadius: 4, overflow: "hidden", flexDirection: "row" },
  }),
  kicker: (ink: string) => ({ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" as const, color: ink }),
};
