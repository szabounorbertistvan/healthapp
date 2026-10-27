import type { FeedPostV1, WorkoutDoneV1 } from "@healthapp/api/v1";
import { AI_ASSISTANTS, POST_TEXT_MAX, STREAK_SHARE_MIN, aiAssistantUrl, type PhotoOverlay } from "@healthapp/shared";
import { publishPlan } from "@healthapp/shared/media/draft";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Chip } from "@/components/coach-profile-bits";
import { MediaPicker } from "@/components/media-tray";
import { useOverlayStats } from "@/components/photo-overlay";
import { PhotoOverlayEditor } from "@/components/photo-overlay-editor";
import { StoryDownload } from "@/components/photo-story";
import { ShareToFeed, VisibilityPicker, type Visibility } from "@/components/share-feed";
import { ShareWorkoutButton } from "@/components/share-workout";
import { Card, NavIcon, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useMediaDraft } from "@/lib/media";
import { font, useTheme } from "@/lib/theme";

// "Workout completed!" — the web's /workout/[dayId]/done on a phone: what the
// session did to the streak, where it happened (for the gym's tops), the
// session to share to the feed with words and photos and each PR on its own,
// the prompt to carry to an AI assistant, and the Share Workout card. Nothing
// is published until a Share is tapped.

const FLAME = "M12 3c1 3 4 4.5 4 9a4 4 0 0 1-8 0c0-2 1-3 1-3s.5 2 2 2c0-3-1-5 1-8z";
const TROPHY = "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4";
const DUMBBELL = "M6 7v10M18 7v10M3 9v6M21 9v6M6 12h12";
const CHECK = "m5 12 5 5 9-10";

export default function WorkoutDone() {
  const { dayId, session } = useLocalSearchParams<{ dayId: string; session: string }>();
  const { t } = useI18n();
  const { color } = useTheme();
  const s = t.common.social;
  const query = useQuery({ queryKey: ["workout-done", session], queryFn: () => api.workoutDone(session, dayId), enabled: Boolean(session) });
  const d = query.data;
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <T kind="title">{s.workoutCompleted}</T>
        {!d ? (
          query.isError || !session ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : (
          <>
            {d.streak ? <StreakAfter streak={d.streak} /> : null}
            <GymPicker sessionId={session} gym={d.gym} />
            <SharePanel d={d} />
            {d.ai_prompt ? <AiReview prompt={d.ai_prompt} /> : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <ShareWorkoutButton sessionId={session} />
              <Pressable accessibilityRole="link" onPress={() => router.replace({ pathname: "/workout/[dayId]", params: { dayId } })} style={[styles.quiet, { backgroundColor: color.surface }]}>
                <Text style={styles.quietText(color.inkSoft)}>{t.common.shareCard.viewWorkout}</Text>
              </Pressable>
              <Pressable accessibilityRole="link" onPress={() => router.replace("/")} style={[styles.quiet, { backgroundColor: color.surface }]}>
                <Text style={styles.quietText(color.inkSoft)}>{s.skipToToday}</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** StreakAfterWorkout: started / extended, a new record, and a milestone to share. */
function StreakAfter({ streak }: { streak: NonNullable<WorkoutDoneV1["streak"]> }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const x = t.common.streaks;
  if (streak.event === "none") return null;
  const m = streak.milestone;
  return (
    <Card style={{ backgroundColor: color.accentSoft, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <NavIcon d={FLAME} size={21} color={color.accentInk} />
        <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{streak.event === "started" ? x.streakStarted : fill(x.streakExtended, { count: streak.current })}</Text>
      </View>
      {streak.event === "record" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <NavIcon d={TROPHY} size={16} color={color.accentInk} />
          <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{x.newLongest}</Text>
        </View>
      ) : null}
      {m ? (
        <View style={{ marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: color.line, gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <NavIcon d={TROPHY} size={17} color={color.accentInk} />
            <Text style={{ fontFamily: font.bold, fontSize: 14, color: color.ink }}>{fill(x.milestoneTitle, { count: m.milestone })}</Text>
          </View>
          <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{m.milestone === 1 ? x.consecutiveDaysOne : fill(x.consecutiveDays, { count: m.milestone })}</Text>
          {m.milestone >= STREAK_SHARE_MIN ? <ShareToFeed shared={m.shared} share={(v) => api.shareStreak(m.milestone, m.streak_start, v)} /> : null}
        </View>
      ) : null}
      <Text accessibilityRole="link" onPress={() => router.push("/streak")} style={{ marginTop: 6, fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{x.viewStreak}</Text>
    </Card>
  );
}

type GymRef = { id: string; name: string; city: string };

/** SessionGymPicker: where this workout happened — home, recent ones, or a search. */
function GymPicker({ sessionId, gym }: { sessionId: string; gym: WorkoutDoneV1["gym"] }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const m = t.gyms.session;
  const [chosen, setChosen] = useState<GymRef | null>(gym.current);
  const [editing, setEditing] = useState(!gym.current);
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<GymRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!searching) return;
    let live = true;
    const timer = setTimeout(async () => {
      const found = await api.searchGyms(q).catch(() => []);
      if (live) setHits(found.filter((h) => (h.status ?? "active") === "active").slice(0, 6).map((h) => ({ id: h.id, name: h.name, city: h.city })));
    }, q ? 250 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [q, searching]);

  async function pick(g: GymRef | null) {
    setError(false);
    setBusy(true);
    try {
      const r = await api.sessionShare(sessionId, { op: "gym", gymId: g?.id ?? null });
      if (!r.ok) return setError(true);
      setChosen(g);
      setEditing(false);
      setSearching(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  // home first, then recent ones that are not home — no gym twice
  const shortcuts = [gym.home, ...gym.recent.filter((r) => r.id !== gym.home?.id)].filter((x): x is GymRef => Boolean(x)).slice(0, 4);
  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{m.title}</Text>
      {!editing && chosen ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.accentInk }}>{fill(m.saved, { gym: chosen.name })}</Text>
          <Chip on={false} label={m.change} onPress={() => setEditing(true)} />
        </View>
      ) : (
        <>
          <Text style={{ fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: color.inkFaint }}>{m.hint}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {shortcuts.map((g) => <Chip key={g.id} on={g.id === chosen?.id} disabled={busy} label={`${g.id === gym.home?.id ? `${m.home}: ` : ""}${g.name}`} onPress={() => void pick(g)} />)}
            <Chip on={searching} label={m.other} onPress={() => setSearching((v) => !v)} />
            {chosen ? <Chip on={false} disabled={busy} label={m.clear} onPress={() => void pick(null)} /> : null}
          </View>
          {searching ? (
            <View style={{ gap: 6 }}>
              <TextInput autoFocus value={q} onChangeText={setQ} placeholder={m.search} placeholderTextColor={color.inkFaint} accessibilityLabel={m.search}
                style={{ height: 44, borderRadius: 16, backgroundColor: color.bg, paddingHorizontal: 14, fontFamily: font.regular, fontSize: 14, color: color.ink }} />
              {hits.map((h) => (
                <Pressable key={h.id} accessibilityRole="button" disabled={busy} onPress={() => void pick(h)} style={{ borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: color.bg }}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{h.name}</Text>
                  <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{h.city}</Text>
                </Pressable>
              ))}
              <Text accessibilityRole="link" onPress={() => router.push("/gyms")} style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{m.suggest}</Text>
            </View>
          ) : null}
          {error ? <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.risk }}>{t.gyms.errors.generic}</Text> : null}
        </>
      )}
    </Card>
  );
}

/** SharePanel: the session to the feed — words and photos optional — and each PR on its own. */
function SharePanel({ d }: { d: WorkoutDoneV1 }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const s = t.common.social;
  const x = d.session;
  const media = useMediaDraft();
  const [visibility, setVisibility] = useState<Visibility>("followers");
  const [text, setText] = useState("");
  const [shared, setShared] = useState(x.already_shared);
  const [sharedPrs, setSharedPrs] = useState<Set<string>>(new Set(x.prs.filter((p) => p.shared).map((p) => p.set_id)));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<PhotoOverlay | null>(null);
  // the photo the story is made from, kept once the post has gone out (the draft empties then)
  const [kept, setKept] = useState<{ uri: string; width: number; height: number; overlay: PhotoOverlay | null } | null>(null);
  // the figures the photo can carry, worded as the feed card words them (useOverlayStats)
  const overlayStats = useOverlayStats({ kind: "workout", duration_min: x.duration_min, volume_kg: x.volume_kg, sets: x.sets, exercises: x.exercises, load: x.load, prs: x.prs.length } as unknown as FeedPostV1["payload"]);
  const ready = media.draft.items.filter((i) => i.previewUrl && i.width && i.height);
  const single = media.draft.items.length === 1 && ready.length === 1 ? ready[0]! : null;
  const n = (v: number) => v.toLocaleString(locale === "ro" ? "ro-RO" : "en-GB", { maximumFractionDigits: 1 });

  async function share() {
    setError(null);
    // text is optional on a workout: the session is the post
    const plan = publishPlan(media.draft, text || " ");
    if (!plan.ok) return setError(plan.reason === "busy" ? s.mediaWaitUploads : s.mediaFixFailed);
    setPending(true);
    try {
      // the overlay rides on the picture, and only a one-picture post keeps it
      const list = plan.media.length === 1 && overlay ? [{ ...plan.media[0]!, overlay }] : plan.media;
      const r = await api.sessionShare(x.session_id, { op: "workout", visibility, text, media: list.length > 0 ? list : null });
      if (!r.ok) return setError(r.message ?? s.mediaPublishFailed);
      const lead = ready[0];
      if (lead) setKept({ uri: lead.previewUrl!, width: lead.width!, height: lead.height!, overlay: single ? overlay : null });
      media.markPublished();
      setShared(true);
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : s.mediaPublishFailed);
    } finally {
      setPending(false);
    }
  }

  async function sharePr(setId: string) {
    setPending(true);
    try {
      const r = await api.sessionShare(x.session_id, { op: "pr", setId, visibility });
      if (r.ok) setSharedPrs((prev) => new Set([...prev, setId]));
      else setError(r.message ?? s.shareFailed);
    } catch {
      setError(s.shareFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <NavIcon d={DUMBBELL} size={21} color={color.accent} />
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{x.name}</Text>
        </View>
        <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>
          {[d.duration_label, fill(s.exercisesCount, { count: x.exercises }), fill(s.setsCount, { count: x.sets }), fill(s.volume, { kg: n(x.volume_kg) })].filter(Boolean).join("   ")}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <NavIcon d={FLAME} size={17} color={color.accentInk} />
          <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.accentInk }}>{fill(s.trainingLoad, { load: x.load })}</Text>
        </View>
        {!shared ? (
          <View style={{ marginTop: 6, gap: 12 }}>
            <TextInput value={text} onChangeText={(v) => setText(v.slice(0, POST_TEXT_MAX))} placeholder={s.composerPlaceholder} placeholderTextColor={color.inkFaint}
              accessibilityLabel={s.composerPlaceholder} multiline
              style={{ minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: color.line, backgroundColor: color.bg, paddingHorizontal: 14, paddingVertical: 10, fontFamily: font.regular, fontSize: 14, color: color.ink }} />
            {d.uploads ? <MediaPicker api={media} disabled={pending} /> : null}
            {single ? (
              <PhotoOverlayEditor src={single.previewUrl!} width={single.width!} height={single.height!} stats={overlayStats} value={overlay} onChange={setOverlay} disabled={pending} />
            ) : null}
            {ready[0] ? (
              <StoryDownload photo={{ uri: ready[0].previewUrl!, width: ready[0].width!, height: ready[0].height! }} overlay={single ? overlay : null} stats={overlayStats} title={x.name} date={x.date} />
            ) : null}
            <VisibilityPicker value={visibility} onChange={setVisibility} />
            <Pressable accessibilityRole="button" disabled={pending} onPress={() => void share()} style={[styles.primary, { backgroundColor: color.accent, opacity: pending ? 0.5 : 1 }]}>
              {pending ? <ActivityIndicator color={color.accentFg} /> : <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.accentFg }}>{s.shareToFeed}</Text>}
            </Pressable>
          </View>
        ) : (
          <View style={{ marginTop: 6, flexDirection: "row", alignItems: "center", gap: 6 }}>
            <NavIcon d={CHECK} size={16} color={color.accentInk} strokeWidth={2.4} />
            <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.accentInk }}>{s.shared}</Text>
          </View>
        )}
        {shared && kept ? <StoryDownload photo={kept} overlay={kept.overlay} stats={overlayStats} title={x.name} date={x.date} /> : null}
        {error ? <Text accessibilityRole="alert" style={{ fontFamily: font.regular, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
      </Card>
      {x.prs.length > 0 ? (
        <Card style={{ gap: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <NavIcon d={TROPHY} size={16} color={color.accentInk} />
            <T kind="label">{s.newPr}</T>
          </View>
          {x.prs.map((pr, i) => (
            <View key={pr.set_id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: color.line }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{pr.exercise}</Text>
                <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{`${n(pr.weight_kg)} kg × ${pr.reps}`}</Text>
              </View>
              {sharedPrs.has(pr.set_id) ? (
                <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{`✓ ${s.prShared}`}</Text>
              ) : (
                <Pressable accessibilityRole="button" disabled={pending} onPress={() => void sharePr(pr.set_id)} style={[styles.pill, { backgroundColor: color.bg, opacity: pending ? 0.5 : 1 }]}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{s.sharePr}</Text>
                </Pressable>
              )}
            </View>
          ))}
        </Card>
      ) : null}
    </>
  );
}

/** AiReview: the workout's summary carried to an assistant — each tap also offers it to copy. */
function AiReview({ prompt }: { prompt: string }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const s = t.common.aiReview;
  const [preview, setPreview] = useState(false);
  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{s.title}</Text>
      <Text style={{ fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: color.inkFaint }}>{s.hint}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {AI_ASSISTANTS.map((a) => (
          <Pressable key={a.id} accessibilityRole="link" onPress={() => void Linking.openURL(aiAssistantUrl(a, prompt))} style={[styles.chip, { borderColor: color.line, backgroundColor: color.bg }]}>
            <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{a.label}</Text>
          </Pressable>
        ))}
        {/* the phone's own share sheet: any assistant app installed on it shows up as a target; copying is in it too */}
        <Pressable accessibilityRole="button" onPress={() => void Share.share({ message: prompt })} style={[styles.chip, { borderColor: color.line, backgroundColor: color.bg }]}>
          <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{s.otherApp}</Text>
        </Pressable>
      </View>
      <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>{s.pasteHint}</Text>
      <Text accessibilityRole="button" accessibilityState={{ expanded: preview }} onPress={() => setPreview((v) => !v)} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{`${preview ? "▾" : "▸"} ${s.preview}`}</Text>
      {preview ? <Text selectable style={{ borderRadius: 12, padding: 12, backgroundColor: color.bg, fontFamily: font.regular, fontSize: 12, lineHeight: 18, color: color.inkSoft }}>{prompt}</Text> : null}
    </Card>
  );
}

const styles = {
  ...StyleSheet.create({
    body: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48, gap: 14 },
    quiet: { height: 44, borderRadius: 22, paddingHorizontal: 18, justifyContent: "center" },
    primary: { height: 44, borderRadius: 16, alignItems: "center", justifyContent: "center" },
    pill: { height: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: "center" },
    chip: { height: 40, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, justifyContent: "center" },
  }),
  quietText: (ink: string) => ({ fontFamily: font.semibold, fontSize: 13, color: ink }),
};
