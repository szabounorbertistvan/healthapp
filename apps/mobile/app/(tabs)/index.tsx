import { useEffect } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { RecipesCard, SetupCard, useOnboardingStart } from "@/components/onboarding-cards";
import { usePageTour } from "@/components/page-tour";
import { CoachCard, CommunityCard, FitnessCard, HabitsCard, NutritionCard, TrainingCard, WeekCard, WeeklyReportRow } from "@/components/today-cards";
import { Button, Card, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { signOut } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { useMe } from "@/lib/role";
import { useTheme } from "@/lib/theme";
import { capitalize, parseDay } from "@/lib/week";

// Today — the web's /today on a phone (app/(client)/today/page.tsx), one column
// in its order: the day, the week card, the fitness score, training,
// nutrition, habits, coach, community, the weekly report.
export default function Today() {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const query = useOfflineQuery("dashboard", ["today"], api.dashboard);
  const d = query.data?.data;
  const refused = query.error instanceof ApiFailure && query.error.kind === "unauthorized";
  const me = useMe().data?.data;
  useOnboardingStart();
  const tour = usePageTour("today", ["week", "training", "nutrition", "coach"], { ready: Boolean(d) });

  useEffect(() => {
    // The token was refused (revoked, account removed): back to sign-in.
    if (refused) signOut().catch(() => {});
  }, [refused]);

  const day = d ? parseDay(d.today) : new Date();
  const weekday = capitalize(new Intl.DateTimeFormat(locale, { weekday: "long" }).format(day));
  const longDate = capitalize(new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(day));

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
      <ScrollView
        ref={tour.scrollRef}
        onScroll={tour.onScroll}
        scrollEventThrottle={32}
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <T kind="title">{weekday}</T>
            <T kind="faint" style={{ marginTop: 4, fontSize: 13 }}>{longDate}</T>
          </View>
          {tour.button}
        </View>
        {query.data?.fromPhone ? <T kind="faint">{t.mobile.workout.fromPhone}</T> : null}

        <SetupCard />
        {d ? (
          <>
            <View ref={tour.target("week")} collapsable={false}><WeekCard d={d} /></View>
            <FitnessCard d={d} />
            <View ref={tour.target("training")} collapsable={false}><TrainingCard d={d} /></View>
            <View ref={tour.target("nutrition")} collapsable={false}><NutritionCard d={d} /></View>
            <RecipesCard userId={me?.id} />
            <HabitsCard d={d} />
            <View ref={tour.target("coach")} collapsable={false}><CoachCard d={d} /></View>
            <CommunityCard d={d} />
            <WeeklyReportRow />
          </>
        ) : query.isError ? (
          <Card>
            <T kind="heading">{t.mobile.today.loadFailed}</T>
            <T kind="soft">{query.error instanceof ApiFailure && query.error.kind === "offline" ? t.mobile.errors.offline : t.mobile.errors.generic}</T>
            <Button kind="quiet" label={t.mobile.today.retry} onPress={() => void query.refetch()} />
          </Card>
        ) : (
          <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        )}
      </ScrollView>
      {tour.overlay}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // 110 at the bottom: clear of the floating tab bar.
  body: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 110, gap: 16 },
});
