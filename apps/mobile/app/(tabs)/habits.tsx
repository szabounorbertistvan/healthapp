import type { HabitV1 } from "@healthapp/api/v1";
import {
  groupHabitsByCategory, HABIT_SUGGESTION_DAYS, HABIT_SUGGESTION_KEYS, suggestionKeyForName, type HabitSuggestionKey,
} from "@healthapp/i18n/habit-suggestions";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, NavIcon, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { pendingHabitState } from "@/lib/outbox-core";
import { useOutbox } from "@/lib/outbox";
import { alpha, font, useTheme } from "@/lib/theme";

// Habits — the web's /habits on a phone (app/(client)/habits/page.tsx): the
// week's count, the list grouped by category (tick, read what it is for,
// remove), then the ways to add one. A tick is a state sent by the outbox
// through the web's setHabitDone(), so it works with no signal; adding and
// removing need the server.

const CHECK = "m5 12 5 5 9-10";
const CLOSE = "M6 6 18 18M18 6 6 18";

export default function Habits() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const { session } = useAuth();
  const outbox = useOutbox();
  const queryClient = useQueryClient();
  const query = useOfflineQuery("habits", ["habits"], api.habits);
  const data = query.data?.data;
  const userId = session?.user.id ?? "";

  // The rows as shown: a tick still on its way counts already (habit-ticks.tsx does the same).
  const rows: HabitV1[] = (data?.habits ?? []).map((h) => {
    const pending = data ? pendingHabitState(outbox.items, userId, h.id, data.today) : undefined;
    if (pending === undefined || pending === h.done_today) return h;
    return { ...h, done_today: pending, done_this_week: Math.max(0, h.done_this_week + (pending ? 1 : -1)) };
  });
  const ticks = rows.reduce((s, h) => s + h.done_this_week, 0);
  const scheduled = rows.reduce((s, h) => s + h.target_per_week, 0);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["habits"] });
    void queryClient.invalidateQueries({ queryKey: ["today"] });
  }

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <T kind="title">{t.common.nav.habits}</T>
          {data ? (
            <View style={[styles.countPill, { backgroundColor: color.surface }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>
                {fill(t.clientApp.habits.thisWeek, { done: ticks, target: scheduled })}
              </Text>
            </View>
          ) : null}
        </View>
        {query.data?.fromPhone ? <T kind="faint">{t.mobile.workout.fromPhone}</T> : null}

        {!data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : (
          <>
            {rows.length === 0 ? (
              <View style={{ paddingVertical: 8 }}>
                <T kind="heading">{t.clientApp.habits.noHabitsTitle}</T>
                <T kind="faint" style={{ marginTop: 4, lineHeight: 18 }}>{t.clientApp.habits.noHabitsHint}</T>
              </View>
            ) : (
              <Card style={{ gap: 0 }}>
                <HabitList
                  rows={rows}
                  onTick={(h) => void outbox.queue({ kind: "habit", input: { habitId: h.id, day: data.today, done: !h.done_today } })}
                  onRemoved={refresh}
                />
              </Card>
            )}
            <AddHabit existingNames={rows.map((h) => h.name)} onAdded={refresh} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** The list (habit-ticks.tsx, removable): grouped once there are two groups, ⓘ for a suggested one, ✕ with a confirm. */
function HabitList({ rows, onTick, onRemoved }: { rows: HabitV1[]; onTick: (h: HabitV1) => void; onRemoved: () => Promise<void> }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const groups = groupHabitsByCategory(rows);
  const labelled = groups.length > 1;
  const h = t.clientApp.habits;

  async function remove(id: string) {
    setRemoving(true);
    setRemoveError(null);
    try {
      const r = await api.archiveHabit(id);
      if (!r.ok) return setRemoveError(r.message ?? h.couldNotDelete);
      setConfirming(null);
      await onRemoved();
    } catch (error) {
      setRemoveError(error instanceof ApiFailure && error.kind === "offline" ? t.mobile.errors.offline : h.couldNotDelete);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <View style={{ gap: 20 }}>
      {groups.map((group) => (
        <View key={group.category}>
          {labelled ? <Text style={[styles.label(color.inkFaint), { marginBottom: 4 }]}>{t.clientWidgets.habitCategories[group.category]}</Text> : null}
          {group.habits.map((habit, i) => {
            const key = suggestionKeyForName(habit.name);
            const info = key ? t.clientWidgets.habitSuggestions[key] : null;
            const showing = openInfo === habit.id;
            return (
              <View key={habit.id} style={[{ paddingVertical: 4 }, i > 0 ? { borderTopWidth: 1, borderTopColor: alpha(color.line, 0.6) } : null]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: habit.done_today }}
                    onPress={() => onTick(habit)}
                    style={({ pressed }) => [styles.tickRow, pressed && { backgroundColor: color.bg }]}
                  >
                    <View style={[styles.box, habit.done_today ? { borderColor: color.accent, backgroundColor: color.accent } : { borderColor: color.line }]}>
                      {habit.done_today ? <NavIcon d={CHECK} size={12} color={color.accentFg} strokeWidth={3} /> : null}
                    </View>
                    <Text
                      numberOfLines={1}
                      style={{
                        flex: 1, fontFamily: font.medium, fontSize: 13.5,
                        color: habit.done_today ? color.inkFaint : color.ink,
                        textDecorationLine: habit.done_today ? "line-through" : "none",
                      }}
                    >
                      {info ? info.name : habit.name}
                    </Text>
                    <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{`${habit.done_this_week}/${habit.target_per_week}`}</Text>
                  </Pressable>
                  {info ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={h.what}
                      accessibilityState={{ expanded: showing }}
                      onPress={() => setOpenInfo(showing ? null : habit.id)}
                      style={[styles.info, { backgroundColor: showing ? color.accent : color.bg }]}
                    >
                      <Text style={{ fontFamily: font.bold, fontSize: 11, color: showing ? color.accentFg : color.inkFaint }}>i</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={h.deleteHabit}
                    onPress={() => { setRemoveError(null); setConfirming(confirming === habit.id ? null : habit.id); }}
                    style={styles.close}
                  >
                    <NavIcon d={CLOSE} size={15} color={color.inkFaint} />
                  </Pressable>
                </View>
                {confirming === habit.id ? (
                  <View style={[styles.confirm, { backgroundColor: color.riskSoft }]}>
                    <Text style={{ flexShrink: 1, fontFamily: font.semibold, fontSize: 13, color: color.risk }}>{h.deleteConfirm}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Pressable accessibilityRole="button" onPress={() => setConfirming(null)} style={styles.confirmButton}>
                        <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{t.common.actions.cancel}</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={removing}
                        onPress={() => void remove(habit.id)}
                        style={[styles.confirmButton, { backgroundColor: color.risk, opacity: removing ? 0.5 : 1 }]}
                      >
                        <Text style={{ fontFamily: font.bold, fontSize: 12.5, color: color.accentFg }}>{t.common.actions.delete}</Text>
                      </Pressable>
                    </View>
                    {removeError ? <Text style={{ width: "100%", fontFamily: font.regular, fontSize: 12, color: color.risk }}>{removeError}</Text> : null}
                  </View>
                ) : null}
                {info && showing ? (
                  <View style={[styles.infoBox, { backgroundColor: color.bg }]}>
                    <WhatWhy what={info.what} why={info.why} />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function WhatWhy({ what, why }: { what: string; why: string }) {
  const { t } = useI18n();
  const { color } = useTheme();
  return (
    <>
      <Text style={styles.label(color.inkFaint)}>{t.clientApp.habits.what}</Text>
      <Text style={styles.prose(color.inkSoft)}>{what}</Text>
      <Text style={[styles.label(color.inkFaint), { marginTop: 10 }]}>{t.clientApp.habits.why}</Text>
      <Text style={styles.prose(color.inkSoft)}>{why}</Text>
    </>
  );
}

/** Two ways in (add-habit-form.tsx): one of seven suggestions, each with its what and why, or a custom one. */
function AddHabit({ existingNames, onAdded }: { existingNames: string[]; onAdded: () => Promise<void> }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const m = t.clientWidgets.addHabitForm;
  const s = t.clientWidgets.habitSuggestions;
  const [picked, setPicked] = useState<HabitSuggestionKey | null>(null);
  const [name, setName] = useState("");
  const [perWeek, setPerWeek] = useState("7");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const alreadyAdded = new Set(existingNames.map((n) => suggestionKeyForName(n)).filter((k): k is HabitSuggestionKey => k !== null));

  async function add(habitName: string, days: number, after?: () => void) {
    setPending(true);
    setError(null);
    try {
      const result = await api.addHabit(habitName, days);
      if (!result.ok) return setError(result.message ?? m.couldNotAdd);
      after?.();
      await onAdded();
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : m.couldNotAdd);
    } finally {
      setPending(false);
    }
  }

  const gold = (label: string, onPress: () => void, disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.goldButton, { backgroundColor: color.accent, opacity: disabled ? 0.4 : 1 }]}
    >
      <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.accentFg }}>{label}</Text>
    </Pressable>
  );

  return (
    <Card style={{ gap: 20 }}>
      <View>
        <Text style={styles.label(color.inkFaint, 11)}>{m.ideas}</Text>
        <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{m.tapForDetails}</Text>
        <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {HABIT_SUGGESTION_KEYS.map((key) => {
            const on = picked === key;
            const added = alreadyAdded.has(key);
            const bg = on ? color.accent : added ? color.accentSoft : color.bg;
            const ink = on ? color.accentFg : added ? color.accentInk : color.inkSoft;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setPicked(on ? null : key)}
                style={[styles.chip, { backgroundColor: bg }]}
              >
                {added ? <NavIcon d={CHECK} size={14} color={ink} strokeWidth={2.6} /> : null}
                <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: ink }}>{s[key].name}</Text>
              </Pressable>
            );
          })}
        </View>

        {picked ? (
          <View style={[styles.pickedBox, { backgroundColor: color.bg }]}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 15, color: color.ink, marginBottom: 10 }}>{s[picked].name}</Text>
            <WhatWhy what={s[picked].what} why={s[picked].why} />
            <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
              {gold(alreadyAdded.has(picked) ? t.clientApp.habits.added : m.addThis, () => {
                const key = picked;
                void add(s[key].name, HABIT_SUGGESTION_DAYS[key], () => setPicked(null));
              }, pending || alreadyAdded.has(picked))}
              <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{`${HABIT_SUGGESTION_DAYS[picked]} ${m.daysPerWeek}`}</Text>
            </View>
          </View>
        ) : null}
      </View>

      <View>
        <Text style={[styles.label(color.inkFaint, 11), { marginBottom: 10 }]}>{m.custom}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: 10 }}>
          <View style={{ flexGrow: 1, minWidth: 180, gap: 6 }}>
            <Text style={styles.label(color.inkFaint)}>{m.name}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={m.namePlaceholder}
              placeholderTextColor={color.inkFaint}
              accessibilityLabel={m.name}
              style={[styles.input, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]}
            />
          </View>
          <View style={{ gap: 6 }}>
            <Text style={styles.label(color.inkFaint)}>{m.daysPerWeek}</Text>
            <TextInput
              value={perWeek}
              onChangeText={setPerWeek}
              keyboardType="number-pad"
              accessibilityLabel={m.daysPerWeek}
              style={[styles.input, { width: 80, color: color.ink, backgroundColor: color.bg, borderColor: color.line }]}
            />
          </View>
          {gold(t.common.actions.add, () => {
            // the server clamps to 1–7; say so rather than quietly saving another number
            const days = Number(perWeek.trim());
            if (!(Number.isInteger(days) && days >= 1 && days <= 7)) return setError(m.daysRange);
            void add(name, days, () => setName(""));
          }, pending || !name.trim())}
        </View>
      </View>
      {error ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.risk }}>{error}</Text> : null}
    </Card>
  );
}

const styles = {
  ...StyleSheet.create({
    // 110 at the bottom: clear of the floating tab bar.
    body: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 110, gap: 18 },
    countPill: { height: 36, borderRadius: 18, paddingHorizontal: 16, justifyContent: "center" },
    tickRow: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, paddingHorizontal: 6, paddingVertical: 8 },
    box: { width: 20, height: 20, borderRadius: 7, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
    info: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    close: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
    confirm: { marginTop: 6, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
    confirmButton: { height: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: "center" },
    infoBox: { marginLeft: 36, marginTop: 6, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
    chip: { height: 36, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 18, paddingHorizontal: 14 },
    pickedBox: { marginTop: 14, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14 },
    goldButton: { height: 44, borderRadius: 16, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
    input: { height: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontFamily: font.regular, fontSize: 14 },
  }),
  label: (ink: string, size = 10) => ({ fontFamily: font.semibold, fontSize: size, letterSpacing: 0.6, textTransform: "uppercase" as const, color: ink }),
  prose: (ink: string) => ({ marginTop: 2, fontFamily: font.regular, fontSize: 13, lineHeight: 20, color: ink }),
};
