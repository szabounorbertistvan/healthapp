import { parseStep } from "@healthapp/shared/coach/onboarding";
import type { CoachServiceRow, MyCoachProfile } from "@healthapp/shared/coach/profile";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApplicationCard, BecomeCoachCard, RevisionBanner, StatusPanel, VerificationCard } from "@/components/coach-profile-panels";
import { ServicesStep } from "@/components/coach-profile-lists";
import { CoachProfileWizard } from "@/components/coach-profile-wizard";
import { Hint } from "@/components/settings-forms";
import { Card, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The coach's public profile — the web's /settings/coach-profile on a phone:
// becoming a coach, where the profile stands, an open revision, the
// application review with its documents, Voinic Verified, then the six-step
// editor for a draft (or a revision), else the live services and a link to the
// public page. `?step=n` opens the editor at that step (1-based, as on the
// web); `?focus=verification` scrolls to Verification.

export default function CoachProfileScreen() {
  const { step, focus } = useLocalSearchParams<{ step?: string; focus?: string }>();
  const { t } = useI18n();
  const { color } = useTheme();
  const query = useQuery({ queryKey: ["coach-profile"], queryFn: api.coachProfile });
  const page = query.data;
  const scroller = useRef<ScrollViewInstance>(null);
  const [anchors, setAnchors] = useState<{ wizard?: number; verification?: number }>({});
  const scrolled = useRef(false);

  // a link that names a step or Verification lands there once the page has laid out
  useEffect(() => {
    if (scrolled.current) return;
    const y = focus === "verification" ? anchors.verification : step ? anchors.wizard : undefined;
    if (y === undefined) return;
    scrolled.current = true;
    scroller.current?.scrollTo({ y: Math.max(0, y - 12), animated: false });
  }, [anchors, focus, step]);

  const mine = page?.mine ?? null;
  const editing = Boolean(mine && (mine.profile.status === "draft" || mine.revision));
  const disciplines = mine && page ? page.catalog.specializations.filter((s) => mine.specializations.some((m) => m.slug === s.slug)) : [];

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        ref={scroller}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.marketplace.title} />
        {!page ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : !mine ? (
          <BecomeCoachCard />
        ) : (
          <>
            {mine.profile.status !== "draft" || mine.profile.review_note ? (
              <StatusPanel key={`${mine.profile.status}:${mine.profile.accepting_clients}`} profile={mine.profile} editing={Boolean(mine.revision)} showNote={!page.application} />
            ) : null}
            {mine.revision ? <RevisionBanner revision={mine.revision} /> : null}
            {page.application ? <ApplicationCard application={page.application} uploads={page.uploads} disciplines={disciplines} /> : null}
            <View onLayout={(e) => { const y = e.nativeEvent.layout.y; setAnchors((a) => (a.verification === y ? a : { ...a, verification: y })); }}>
              <VerificationCard data={mine} />
            </View>
            <View onLayout={(e) => { const y = e.nativeEvent.layout.y; setAnchors((a) => (a.wizard === y ? a : { ...a, wizard: y })); }}>
              {editing ? (
                <CoachProfileWizard
                  // a fresh editor after a write that changed what it was built from (submit, discard, a new revision)
                  key={`${mine.profile.status}:${mine.revision?.status ?? ""}`}
                  page={{ ...page, mine }}
                  startStep={parseStep(step)}
                  // a revision of a live profile is reviewed as a change, not as a new application
                  documentsMissing={mine.revision ? [] : page.application?.missing ?? []}
                  onScrollTop={() => scroller.current?.scrollTo({ y: anchors.wizard ?? 0, animated: true })}
                />
              ) : mine.profile.status !== "suspended" && mine.services.length > 0 ? (
                <ServicesManager key={mine.services.map((s) => `${s.id}${s.active}`).join()} mine={mine} />
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Outside a draft: switch services on and off and reorder them, live, without a review (ServicesManager). */
function ServicesManager({ mine }: { mine: MyCoachProfile }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const s = t.coachProfile.services;
  const [rows, setRows] = useState<CoachServiceRow[]>(mine.services);
  return (
    <Card style={{ gap: 0 }}>
      <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{s.manageTitle}</Text>
      <Hint>{s.manageHint}</Hint>
      <View style={{ marginTop: 12 }}>
        <ServicesStep mode="manage" rows={rows} onChange={(next) => {
          setRows(next);
          void queryClient.invalidateQueries({ queryKey: ["coach-marketplace"] });
        }} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
});
