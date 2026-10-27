import type { CoachClientPageV1 } from "@healthapp/api/v1";
import { FITNESS_SCORE_MIN_WORKOUTS, FITNESS_SCORE_WEIGHTS, type FitnessScore, type ProgressionReason } from "@healthapp/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ClientGoals } from "@/components/goals";
import { PostCard } from "@/components/post-card";
import { SessionView, type CoachActions } from "@/components/session-view";
import { Bar, Button, Card, T } from "@/components/ui";
import { WeeklyCard } from "@/components/weekly-card";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/role";
import { shareFile } from "@/lib/share-file";
import { font, useTheme } from "@/lib/theme";

// One client, from the coach's side — the web's /clients/[id] on a phone:
// their goal, the 28-day fitness score and the main lifts' verdicts (Coach
// Pro), the weekly summary with its week switch, the last finished workouts to
// comment on (the whole workout or one set), and what they shared. New
// program / New plan open the coach's own screens. Read under RLS throughout.

type Key = keyof typeof FITNESS_SCORE_WEIGHTS;
const KEYS: readonly Key[] = ["trainingLoad", "consistency", "frequency", "volume"];
const sub = (s: FitnessScore, k: Key) =>
  k === "trainingLoad" ? s.trainingLoadScore : k === "consistency" ? s.consistencyScore : k === "frequency" ? s.frequencyScore : s.volumeScore;

export default function CoachClient() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const unit = useMe().data?.data.weight_unit ?? "kg";
  const [week, setWeek] = useState<"current" | "previous">("current");
  const query = useQuery({ queryKey: ["coach-client", id, week], queryFn: () => api.coachClient(id, week), placeholderData: (p) => p });
  const c = query.data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = t.coachWidgets.workoutFeedback;

  const coach: CoachActions = {
    busy,
    comment: async (setId, body) => {
      setBusy(true);
      setError(null);
      try {
        const session = c?.workouts.find((w) => setId === null || w.sets.some((s) => s.id === setId));
        const r = await api.workoutFeedback({ clientId: id, referenceType: setId ? "set" : "session", referenceId: setId ?? session?.id ?? "", body });
        if (!r.ok) setError(r.message ?? m.failed);
        await queryClient.invalidateQueries({ queryKey: ["coach-client", id] });
        return r.ok;
      } catch (e) {
        setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : m.failed);
        return false;
      } finally {
        setBusy(false);
      }
    },
    takeBack: async (feedbackId) => {
      setBusy(true);
      try {
        const r = await api.workoutFeedback({ op: "delete", feedbackId, clientId: id });
        if (!r.ok) setError(r.message ?? m.failed);
        await queryClient.invalidateQueries({ queryKey: ["coach-client", id] });
      } catch {
        setError(m.failed);
      } finally {
        setBusy(false);
      }
    },
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.common.nav.clients} />
        {!c ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : (
          <>
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                <T kind="title">{c.name}</T>
                {c.analytics ? <SignalPill signal={c.signal} /> : null}
              </View>
              {c.goal ? (
                <Text style={{ fontFamily: font.regular, fontSize: 13.5, color: color.inkSoft }}>
                  <Text style={{ fontFamily: font.semibold, color: color.ink }}>{`${t.coachView.goal} `}</Text>
                  {c.goal}
                </Text>
              ) : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                <Button height={42} label={t.coachApp.programs.newProgram} onPress={() => router.push("/coach/programs")} />
                <Button height={42} kind="quiet" label={t.coachApp.nutrition.newPlan} onPress={() => router.push("/coach/nutrition")} />
              </View>
            </View>

            {c.fitness ? <Fitness c={c} /> : null}
            {c.weekly ? <WeeklyCard summary={c.weekly} onSwitch={setWeek} /> : <T kind="faint">{t.common.weekly.noData}</T>}
            {c.lifts ? <Lifts lifts={c.lifts} /> : null}
            {c.goals ? <ClientGoals data={c.goals} name={c.name} /> : null}
            {c.reports && c.reports.length > 0 ? <ReportDownload clientId={c.id} name={c.name} options={c.reports} /> : null}

            <View style={{ gap: 10 }}>
              <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{m.title}</Text>
              <T kind="faint" style={{ lineHeight: 18 }}>{fill(m.lead, { name: c.name })}</T>
              {c.workouts.length === 0 ? <T kind="faint">{m.empty}</T> : null}
              {c.workouts.map((w) => (
                <View key={w.id} style={{ gap: 6 }}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>
                    {`${w.name ?? m.freeWorkout} · ${new Date(w.started_at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`}
                  </Text>
                  <SessionView session={w} unit={unit} coach={coach} />
                </View>
              ))}
              {error ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
            </View>

            <View style={{ gap: 10 }}>
              <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{fill(t.coachApp.clients.postsTitle, { name: c.name })}</Text>
              {c.posts.length === 0 ? <Card><T kind="faint">{t.coachApp.clients.postsEmpty}</T></Card> : c.posts.map((p) => <PostCard key={p.id} post={p} />)}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SignalPill({ signal }: { signal: string }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const tone = signal === "at_risk" ? { bg: color.riskSoft, ink: color.risk } : signal === "needs_attention" ? { bg: color.warnSoft, ink: color.warn } : { bg: color.accentSoft, ink: color.accentInk };
  const label = (t.common.signal as Record<string, string>)[signal] ?? signal;
  return (
    <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: tone.bg }}>
      <Text style={{ fontFamily: font.semibold, fontSize: 12, color: tone.ink }}>{label}</Text>
    </View>
  );
}

/** The coach's score card (fitness-score.tsx FitnessScoreCoachCard): the number or Building, the trend, the four parts. */
function Fitness({ c }: { c: CoachClientPageV1 }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const f = t.common.fitnessScore;
  const v = c.fitness!;
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <T kind="label">{f.coachTitle}</T>
        <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{f.last28Days}</Text>
      </View>
      {v.current.status === "building" ? (
        <T kind="soft">{fill(f.coachBuilding, { done: v.current.completedWorkouts, needed: FITNESS_SCORE_MIN_WORKOUTS })}</T>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10 }}>
          <Text style={{ fontFamily: font.displayExtrabold, fontSize: 38, color: color.ink }}>{String(v.current.score)}</Text>
          <Text style={{ fontFamily: font.semibold, fontSize: 15, color: color.accentInk }}>{v.current.band ? f.band[v.current.band] : ""}</Text>
          <Text style={{ marginLeft: "auto", fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>
            {v.trend.delta === null ? f.trendNoPrevious : `${v.trend.direction === "stable" ? f.trendNoChange : v.trend.delta > 0 ? `+${v.trend.delta}` : v.trend.delta} ${f.trendVsPrevious}`}
          </Text>
        </View>
      )}
      {KEYS.map((k) => {
        const value = sub(v.current, k);
        return (
          <View key={k} style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{f.components[k]}</Text>
              <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{String(Math.round(value))}</Text>
            </View>
            <Bar ratio={value / 100} height={5} />
          </View>
        );
      })}
    </Card>
  );
}

/** Main lifts (exercise-progression.tsx ProgressionOverview, the coach's view): each lift, its verdict, the first reason. */
function Lifts({ lifts }: { lifts: NonNullable<CoachClientPageV1["lifts"]> }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const p = t.clientApp.progression;
  const n1 = (v: number) => (Math.round(v * 10) / 10).toString();
  const reason = (r: ProgressionReason): string => {
    switch (r.code) {
      case "new_best": {
        const ago = r.sessions_ago === 0 ? p.reason.newBestToday : r.sessions_ago === 1 ? p.reason.newBestAgoOne : fill(p.reason.newBestAgo, { count: r.sessions_ago });
        return fill(p.reason.new_best, { ago, change: n1(r.change_pct) });
      }
      case "within_band": return fill(p.reason.within_band, { band: n1(r.band_pct), count: r.sessions });
      case "no_new_best": return fill(p.reason.no_new_best, { count: r.sessions, days: r.days });
      case "repeated_drop": return fill(p.reason.repeated_drop, { drops: r.drops, of: r.of, drop: Math.round(r.drop_pct) });
      case "isolated_dip": return fill(p.reason.isolated_dip, { drops: r.drops, of: r.of });
      default: return fill(p.reason[r.code], { have: r.have, need: r.need });
    }
  };
  const tone = (s: string) => (s === "progress" ? { bg: color.accentSoft, ink: color.accentInk } : s === "regression" ? { bg: color.riskSoft, ink: color.risk } : s === "plateau" ? { bg: color.warnSoft, ink: color.warn } : { bg: color.bg, ink: color.inkSoft });
  return (
    <Card style={{ gap: 10 }}>
      <View>
        <T kind="label">{p.coachOverviewTitle}</T>
        <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{p.coachOverviewHint}</Text>
      </View>
      {lifts.length === 0 ? <T kind="faint">{p.coachOverviewEmpty}</T> : null}
      {lifts.map(({ id, name, analysis }, i) => (
        <View key={id} style={[{ gap: 4, paddingTop: i > 0 ? 10 : 0 }, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line } : null]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{name}</Text>
            <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: tone(analysis.status).bg }}>
              <Text style={{ fontFamily: font.bold, fontSize: 11, color: tone(analysis.status).ink }}>{p.status[analysis.status]}</Text>
            </View>
          </View>
          {analysis.reasons[0] ? <Text style={{ fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: color.inkSoft }}>{reason(analysis.reasons[0])}</Text> : null}
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 16 },
});

/** The coach's copy of the client's progress PDF (ClientReportDownload): pick a period, then the phone's share sheet. */
function ReportDownload({ clientId, name, options }: { clientId: string; name: string; options: NonNullable<CoachClientPageV1["reports"]> }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const r = t.clientApp.reports;
  const [days, setDays] = useState(options[0]!.days);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const chosen = options.find((o) => o.days === days) ?? options[0]!;

  async function download() {
    setBusy(true);
    setStatus(null);
    try {
      const bytes = await api.coachClientReport(clientId, chosen.days);
      await shareFile(chosen.file_name, bytes, "application/pdf", "com.adobe.pdf");
      setStatus({ ok: true, text: r.done });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : e instanceof Error && e.message ? e.message : r.errors.REPORT_FAILED });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{fill(r.coachTitle, { name })}</Text>
      <T kind="soft">{r.coachHint}</T>
      <T kind="label">{r.periodLabel}</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {options.map((o) => {
          const on = o.days === days;
          return (
            <Text key={o.days} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setDays(o.days)}
              style={{ overflow: "hidden", borderRadius: 17, paddingHorizontal: 14, paddingVertical: 8, fontFamily: font.semibold, fontSize: 12.5, color: on ? color.accentFg : color.inkSoft, backgroundColor: on ? color.accent : color.bg }}>
              {o.days === 365 ? r.periodYear : fill(r.periodDays, { days: o.days })}
            </Text>
          );
        })}
      </View>
      <Button height={44} label={busy ? r.downloading : `${r.download} · ${r.share}`} busy={busy} onPress={() => void download()} />
      {status ? <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: status.ok ? color.accentInk : color.risk }}>{status.text}</Text> : null}
    </Card>
  );
}
