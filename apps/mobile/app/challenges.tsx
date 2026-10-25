import type { ChallengeCardV1 } from "@healthapp/api/v1";
import { CHALLENGE_DIFFICULTIES, CHALLENGE_TYPES, isChallengeType, requiresExercise } from "@healthapp/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChallengeBar, CLOCK, deadlineText, PEOPLE, statusTone, TYPE_ICON } from "@/components/challenge-bits";
import { Card, NavIcon, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { font, useTheme } from "@/lib/theme";
import { parseDay } from "@/lib/week";

// Challenges — the web's /challenges on a phone: start your own (collapsed by
// default), then every challenge the person can see, grouped by where it
// stands for them, each card with its progress from the database and join /
// leave. A card opens the challenge's own page (app/challenge/[id].tsx).

type Status = ChallengeCardV1["status"];

export default function Challenges() {
  const { t } = useI18n();
  const { color } = useTheme();
  const ch = t.common.challenges;
  const query = useOfflineQuery("challenges", ["challenges"], api.challenges);
  const cards = query.data?.data.cards;
  const groups: Status[] = ["active", "upcoming", "completed", "ended"];

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.common.nav.today} />
        <T kind="title">{ch.title}</T>
        <CreateChallenge exercises={query.data?.data.exercises ?? []} />

        {!cards ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : cards.length === 0 ? (
          <View style={{ paddingVertical: 8 }}>
            <T kind="heading">{ch.empty}</T>
            <T kind="faint" style={{ marginTop: 4 }}>{ch.emptyHint}</T>
          </View>
        ) : (
          groups.map((status) => {
            const items = cards.filter((c) => c.status === status);
            if (items.length === 0) return null;
            return (
              <View key={status} style={{ gap: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontFamily: font.bold, fontSize: 12, letterSpacing: 0.72, textTransform: "uppercase", color: color.inkSoft }}>{ch.sections[status]}</Text>
                  <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: color.surface }}>
                    <Text style={{ fontFamily: font.semibold, fontSize: 11, color: color.inkFaint }}>{items.length}</Text>
                  </View>
                </View>
                {items.map((c) => <ChallengeCard key={c.id} c={c} />)}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Today and the last day of this month — the usual window (challenge-create.tsx). */
function defaultWindow() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return { start: iso(now), end: iso(end) };
}

/** Start your own challenge (challenge-create.tsx): collapsed until asked for. */
function CreateChallenge({ exercises }: { exercises: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const ch = t.common.challenges;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const window0 = defaultWindow();
  const [form, setForm] = useState({
    name: "",
    description: "",
    type: "workouts" as string,
    targetValue: "12",
    startDate: window0.start,
    endDate: window0.end,
    visibility: "public" as "public" | "private",
    difficulty: "" as string,
    exerciseId: "" as string,
  });
  const needsExercise = isChallengeType(form.type) && requiresExercise(form.type);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.createChallenge({
        ...form,
        targetValue: Number(form.targetValue.replace(",", ".")),
        difficulty: form.difficulty || null,
        exerciseId: needsExercise ? form.exerciseId || null : null,
      });
      if (!result.ok) return setError(result.message ?? ch.unknownType);
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["challenges"] });
      if (result.id) router.push({ pathname: "/challenge/[id]", params: { id: result.id } });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : ch.unknownType);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={[styles.openButton, { backgroundColor: color.surface }]}>
        <NavIcon d="M12 5v14M5 12h14" size={16} color={color.inkSoft} strokeWidth={2.4} />
        <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.inkSoft }}>{ch.createTitle}</Text>
      </Pressable>
    );
  }

  const label = (text: string) => <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{text}</Text>;
  const input = (value: string, onChange: (v: string) => void, extra: object = {}) => (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholderTextColor={color.inkFaint}
      style={[styles.input, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]}
      {...extra}
    />
  );
  const chips = (values: readonly string[], value: string, onPick: (v: string) => void, text: (v: string) => string) => (
    <View style={{ marginTop: 6, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {values.map((v) => {
        const on = v === value;
        return (
          <Pressable key={v || "none"} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onPick(v)} style={[styles.chip, { backgroundColor: on ? color.accent : color.bg, borderColor: on ? color.accent : color.line }]}>
            <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: on ? color.accentFg : color.inkSoft }}>{text(v)}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <Card style={{ gap: 14 }}>
      <View>
        <Text style={{ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: color.inkFaint }}>{ch.createTitle}</Text>
        <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: color.inkFaint }}>{ch.createHint}</Text>
      </View>
      <View>{label(ch.nameLabel)}{input(form.name, (v) => set("name", v), { placeholder: ch.namePlaceholder, accessibilityLabel: ch.nameLabel })}</View>
      <View>{label(ch.descriptionLabel)}{input(form.description, (v) => set("description", v), { accessibilityLabel: ch.descriptionLabel })}</View>
      <View>
        {label(ch.typeLabel)}
        {chips(CHALLENGE_TYPES, form.type, (v) => set("type", v), (v) => ch.type[v as keyof typeof ch.type])}
        <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.inkFaint }}>{isChallengeType(form.type) ? ch.typeHint[form.type] : ""}</Text>
      </View>
      {needsExercise ? (
        <View>
          {label(ch.exerciseLabel)}
          {exercises.length === 0 ? (
            <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{ch.noLoggedExercises}</Text>
          ) : (
            chips(exercises.map((x) => x.id), form.exerciseId, (v) => set("exerciseId", v), (v) => exercises.find((x) => x.id === v)?.name ?? v)
          )}
        </View>
      ) : null}
      <View>
        {label(`${ch.targetLabel} (${ch.unit[form.type as keyof typeof ch.unit] ?? ""})`)}
        {input(form.targetValue, (v) => set("targetValue", v), { keyboardType: "decimal-pad", accessibilityLabel: ch.targetLabel })}
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>{label(ch.startLabel)}{input(form.startDate, (v) => set("startDate", v), { placeholder: "yyyy-mm-dd", autoCapitalize: "none", accessibilityLabel: ch.startLabel })}</View>
        <View style={{ flex: 1 }}>{label(ch.endLabel)}{input(form.endDate, (v) => set("endDate", v), { placeholder: "yyyy-mm-dd", autoCapitalize: "none", accessibilityLabel: ch.endLabel })}</View>
      </View>
      <View>{label(ch.difficultyLabel)}{chips(["", ...CHALLENGE_DIFFICULTIES], form.difficulty, (v) => set("difficulty", v), (v) => (v ? ch.difficulty[v as keyof typeof ch.difficulty] : "—"))}</View>
      <View>
        {label(ch.visibilityLabel)}
        {chips(["public", "private"], form.visibility, (v) => set("visibility", v as "public" | "private"), (v) => (v === "public" ? ch.visibilityPublic : ch.visibilityPrivate))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          disabled={busy || form.name.trim().length < 3}
          onPress={() => void submit()}
          style={[styles.create, { backgroundColor: color.accent, opacity: busy || form.name.trim().length < 3 ? 0.5 : 1 }]}
        >
          {busy ? <ActivityIndicator color={color.accentFg} /> : <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.accentFg }}>{ch.create}</Text>}
        </Pressable>
        <Text accessibilityRole="button" onPress={() => setOpen(false)} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{t.common.actions.cancel}</Text>
      </View>
      {error ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.risk }}>{error}</Text> : null}
    </Card>
  );
}

function ChallengeCard({ c }: { c: ChallengeCardV1 }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const ch = t.common.challenges;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tag = locale === "ro" ? "ro-RO" : "en-GB";
  const nf = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
  const df = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short" });
  const completed = c.status === "completed";
  const tone = statusTone(c.status, color);

  async function act(join: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = join ? await api.joinChallenge(c.id) : await api.leaveChallenge(c.id);
      if (!result.ok) setError(result.message ?? t.mobile.errors.generic);
      await queryClient.invalidateQueries({ queryKey: ["challenges"] });
      void queryClient.invalidateQueries({ queryKey: ["today"] });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : t.mobile.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: "/challenge/[id]", params: { id: c.id } })}>
      <Card style={{ gap: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <NavIcon d={TYPE_ICON[c.type] ?? TYPE_ICON.workouts!} size={44} color={color.accentInk} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{c.title}</Text>
              <Text numberOfLines={1} style={{ marginTop: 2, fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: color.inkFaint }}>{c.subtitle}</Text>
            </View>
          </View>
          <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: tone.bg }}>
            <Text style={{ fontFamily: font.bold, fontSize: 11, color: tone.ink }}>{ch.status[c.status]}</Text>
          </View>
        </View>
        {c.is_platform ? (
          <View style={{ marginTop: 8, alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, backgroundColor: color.accentSoft }}>
            <Text style={{ fontFamily: font.semibold, fontSize: 11, color: color.accentInk }}>{ch.platform}</Text>
          </View>
        ) : null}
        {c.description ? <Text style={{ marginTop: 8, fontFamily: font.regular, fontSize: 13, lineHeight: 20, color: color.inkSoft }}>{c.description}</Text> : null}

        <View style={{ marginTop: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            {c.joined ? (
              <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
                <Text style={{ fontFamily: font.displayExtrabold, fontSize: 16, color: color.ink }}>{nf.format(c.progress)}</Text>
                {` / ${nf.format(c.target)} ${c.unit_label}`}
              </Text>
            ) : (
              <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{`${ch.target}: ${nf.format(c.target)} ${c.unit_label}`}</Text>
            )}
            {c.joined ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{`${nf.format(c.pct)}%`}</Text> : null}
          </View>
          <View style={{ marginTop: 6 }}>
            <ChallengeBar pct={c.joined ? c.pct : 0} completed={completed} />
          </View>
        </View>

        <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <NavIcon d={CLOCK} size={18} color={color.accentInk} />
            <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{deadlineText(c, ch, fill, (d) => df.format(parseDay(d)))}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <NavIcon d={PEOPLE} size={18} color={color.accentInk} />
            <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{c.participants === 1 ? ch.participantsOne : fill(ch.participants, { count: c.participants })}</Text>
          </View>
        </View>

        <View style={{ marginTop: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          {completed ? (
            <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{ch.completed}</Text>
          ) : c.joined ? (
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void act(false)} style={[styles.pill, { backgroundColor: color.bg, opacity: busy ? 0.5 : 1 }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{ch.leave}</Text>
            </Pressable>
          ) : c.can_join ? (
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void act(true)} style={[styles.pill, { backgroundColor: color.accent, opacity: busy ? 0.5 : 1 }]}>
              <Text style={{ fontFamily: font.bold, fontSize: 12.5, color: color.accentFg }}>{ch.join}</Text>
            </Pressable>
          ) : (
            <View />
          )}
          <View style={{ width: 32, height: 32, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: color.accentSoft }}>
            <NavIcon d="m9 6 6 6-6 6" size={14} color={color.accentInk} strokeWidth={2.2} />
          </View>
        </View>
        {error ? <Text style={{ marginTop: 8, fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 16 },
  pill: { height: 36, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 18, paddingHorizontal: 14 },
  openButton: { height: 44, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 16, paddingHorizontal: 20 },
  input: { marginTop: 6, height: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontFamily: font.regular, fontSize: 14 },
  chip: { minHeight: 36, borderRadius: 18, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, justifyContent: "center" },
  create: { height: 44, minWidth: 120, borderRadius: 16, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
});
