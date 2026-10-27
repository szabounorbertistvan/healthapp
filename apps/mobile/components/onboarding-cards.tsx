import {
  RECIPES_TIP_KEY, audienceOf, setupProgress, shouldShowRecipesTip, shouldStartOnboarding, showSetupCard, type SetupFacts,
} from "@healthapp/shared/onboarding";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { Primary, Small } from "@/components/coach-profile-bits";
import { Card, NavIcon } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { recipesLater, snoozeRecipes, useOnboarding } from "@/lib/onboarding";
import { font, useTheme } from "@/lib/theme";

// The onboarding cards on Today (client) and the dashboard (coach): "Finish
// setting up" (components/onboarding/setup-card.tsx) and the DishFinder recipes
// tip (recipes-card.tsx), each decided by the web's own rule
// (showSetupCard / shouldShowRecipesTip), plus the one-time trip to the
// welcome cards for a brand-new account (shouldStartOnboarding).

/** A brand-new account is sent to the welcome cards once per app start, as /today and /dashboard do on the web. */
let startedThisSession = false;

export function useOnboardingStart() {
  const { data } = useOnboarding();
  useEffect(() => {
    if (!data || startedThisSession) return;
    if (!shouldStartOnboarding(data.state, data.role)) return;
    startedThisSession = true;
    router.push("/onboarding");
  }, [data]);
}

/** "Finish setting up — 2 of 4 steps done": the way back to skipped or unfinished setup steps. Hide is remembered across devices. */
export function SetupCard() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const c = t.onboarding.card;
  const { data, state, mark } = useOnboarding();
  if (!data || !state) return null;
  const progress = setupProgress(data.audience, data.facts as SetupFacts, state);
  if (!showSetupCard(state, progress, data.role)) return null;
  const { done, total } = progress;
  const width = `${Math.round((done / Math.max(total, 1)) * 100)}%` as const;

  return (
    <Card style={{ gap: 12 }}>
      <View>
        <Text accessibilityRole="header" style={{ fontFamily: font.displayBold, fontSize: 15, color: color.ink }}>{c.title}</Text>
        <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{fill(c.progress, { done, total })}</Text>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: total, now: done }}
          accessibilityLabel={fill(c.progress, { done, total })}
          style={{ marginTop: 8, height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: color.bg }}
        >
          <View style={{ height: "100%", width, borderRadius: 3, backgroundColor: color.accent }} />
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Primary label={c.continue} onPress={() => router.push("/onboarding")} />
        <Text accessibilityRole="button" accessibilityLabel={c.hideLabel} onPress={() => void mark("setup", "dismissed")} style={{ paddingHorizontal: 12, paddingVertical: 10, fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>
          {c.hide}
        </Text>
      </View>
    </Card>
  );
}

/** "Have you found the DishFinder recipes?" — Discover / Got it mark it done, × dismisses, Later hides it on this phone for a week. */
export function RecipesCard({ userId }: { userId: string | undefined }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const r = t.onboarding.recipes;
  const names = { nutrition: t.common.nav.nutrition, myTraining: t.common.nav.myTraining };
  const { data, state, mark } = useOnboarding();
  const [later, setLater] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void recipesLater(userId).then((v) => {
      if (live) setLater(v);
    });
    return () => {
      live = false;
    };
  }, [userId]);

  if (!data || !userId || later === null || !data.recipes_url) return null;
  if (!shouldShowRecipesTip(state, data.role, { enabled: true, later })) return null;
  const url = data.recipes_url;
  const audience = audienceOf(data.role);
  const finish = (how: "done" | "dismissed") => void mark(RECIPES_TIP_KEY, how);

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: color.accentInk }}>{r.eyebrow}</Text>
          <Text accessibilityRole="header" style={{ marginTop: 2, fontFamily: font.displayBold, fontSize: 15, color: color.ink }}>{r.title}</Text>
          <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.inkSoft }}>{fill(audience === "coach" ? r.coachBody : r.body, names)}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={r.close} onPress={() => finish("dismissed")} hitSlop={8} style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
          <NavIcon d="M6 6l12 12M18 6 6 18" size={16} color={color.inkFaint} />
        </Pressable>
      </View>
      {open ? (
        <View accessibilityLabel={r.stepsLabel} style={{ gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: color.line }}>
          {r.steps.map((s, i) => (
            <View key={s.title} style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: color.accentSoft }}>
                <Text style={{ fontFamily: font.bold, fontSize: 12, color: color.accentInk }}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{fill(s.title, names)}</Text>
                <Text style={{ fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.inkSoft }}>
                  {fill(i === 0 ? (audience === "coach" ? r.step1Coach : r.step1Client) : s.body, names)}
                </Text>
                {i === 0 ? (
                  <Text accessibilityRole="link" onPress={() => router.push("/food")} style={{ marginTop: 4, fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>
                    {`${fill(r.openNutrition, names)} →`}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Primary label={`${r.discover} ↗`} onPress={() => {
          void Linking.openURL(url);
          finish("done");
        }} />
        {open ? <Small label={r.done} onPress={() => finish("done")} /> : null}
        <Text accessibilityRole="button" onPress={() => setOpen((o) => !o)} style={{ paddingHorizontal: 10, paddingVertical: 10, fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>
          {open ? r.hideHow : r.how}
        </Text>
        <Text accessibilityRole="button" onPress={() => {
          setLater(true);
          void snoozeRecipes(userId);
        }} style={{ paddingHorizontal: 10, paddingVertical: 10, fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>
          {r.later}
        </Text>
      </View>
    </Card>
  );
}
