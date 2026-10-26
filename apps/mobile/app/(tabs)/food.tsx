import { MEAL_SLOTS_V1, type FoodDayV1, type MacrosV1, type MealSlotV1 } from "@healthapp/api/v1";
import { isValidPortionGrams, MAX_PORTION_GRAMS, portionMacros } from "@healthapp/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";
import { TargetsForm } from "@/components/targets-form";
import { Pill } from "@/components/training";
import { Card, NavIcon, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { diary, shiftDay, sumMacros, totalsWithPending, type DiaryEntry } from "@/lib/food-model";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { queuedFoodFor } from "@/lib/outbox-core";
import { useOutbox } from "@/lib/outbox";
import { alpha, font, useTheme } from "@/lib/theme";
import { capitalize, parseDay, weekDaysOf } from "@/lib/week";

// Nutrition — the web's /food diary on a phone (app/(client)/food/page.tsx):
// Diary | Trends, the week strip, the day's summary (goal, eaten, what is
// left, the three macro rings), then the four meals with what was logged,
// what the plan says, "ate as planned" and "same as yesterday". A log added
// here goes through the outbox, so it shows at once and is sent when there is
// signal; edits and removals need the server.


/** A 24-box icon per slot (meal-card.tsx SLOT_ICON): a cup, the midday sun, a moon, a piece of fruit. */
const SLOT_ICON: Record<MealSlotV1, string> = {
  breakfast: "M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 9h2a2 2 0 0 1 0 4h-2M4 21h15",
  lunch: "M12 7a5 5 0 1 0 0 10 5 5 0 1 0 0-10M12 2v2M12 20v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4",
  dinner: "M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5z",
  snack: "M12 8c0-2 1.5-3.5 3.5-3.5M8.5 8C6 8 4 10.2 4 13c0 4 3 7.5 5 7.5 1.2 0 1.8-.6 3-.6s1.8.6 3 .6c2 0 5-3.5 5-7.5 0-2.8-2-5-4.5-5-1.6 0-2.3.7-3.5.7S10.1 8 8.5 8z",
};

export default function Food() {
  const { t } = useI18n();
  const { color } = useTheme();
  const { session } = useAuth();
  const outbox = useOutbox();
  const queryClient = useQueryClient();
  const [day, setDay] = useState<string | null>(null);
  // A day opened from the trends (a bar, a history row) arrives as ?day=.
  const params = useLocalSearchParams<{ day?: string }>();
  useEffect(() => {
    if (params.day && /^d{4}-d{2}-d{2}$/.test(params.day)) setDay(params.day);
  }, [params.day]);
  const query = useOfflineQuery(`food:${day ?? "today"}`, ["food", day ?? "today"], () => api.foodDay(day ?? undefined));
  const data = query.data?.data;
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const f = t.clientApp.food;

  const queued = data && session ? queuedFoodFor(outbox.items, session.user.id, data.day) : [];

  /** A write that needs the server: run it, then re-read the day (and Today). */
  async function online(key: string, work: () => Promise<{ ok: boolean; message?: string }>): Promise<boolean> {
    setBusy(key);
    setMessage(null);
    try {
      const result = await work();
      if (!result.ok) setMessage(result.message ?? t.mobile.errors.generic);
      await queryClient.invalidateQueries({ queryKey: ["food"] });
      void queryClient.invalidateQueries({ queryKey: ["today"] });
      return result.ok;
    } catch (error) {
      setMessage(error instanceof ApiFailure && error.kind === "offline" ? t.mobile.food.needsSignal : t.mobile.errors.generic);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const slotLabel: Record<MealSlotV1, string> = { breakfast: f.breakfast, lunch: f.lunch, dinner: f.dinner, snack: f.snack };

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
          <View style={{ flexGrow: 1, minWidth: 140 }}>
            <Segmented
              items={[
                { label: t.clientApp.nutritionTrends.diary, active: true, onPress: () => {} },
                { label: t.clientApp.nutritionTrends.trends, active: false, onPress: () => router.push("/food-trends") },
              ]}
            />
          </View>
          {data && data.plan_owner !== "coach" ? <Pill label={t.clientApp.mealPlan.link} onPress={() => router.push("/meal-plan")} /> : null}
          <Pill label={t.clientApp.recipes.link} onPress={() => router.push("/recipes")} />
        </View>

        {data ? <WeekStrip data={data} onPick={setDay} /> : null}
        {query.data?.fromPhone ? <T kind="faint">{t.mobile.workout.fromPhone}</T> : null}

        {!data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : (
          <>
            <Summary data={data} totals={totalsWithPending(data, queued)} />
            {message ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.risk }}>{message}</Text> : null}
            <View style={{ gap: 14 }}>
              {MEAL_SLOTS_V1.map((slot) => (
                <MealCard
                  key={slot}
                  slot={slot}
                  label={slotLabel[slot]}
                  data={data}
                  entries={diary(data, queued)[slot]}
                  busy={busy}
                  online={online}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Two (or more) options in a surface track, the active one raised on the page background (FoodViewTabs). */
function Segmented({ items }: { items: { label: string; active: boolean; onPress: () => void }[] }) {
  const { color } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 4, borderRadius: 16, padding: 4, backgroundColor: color.surface }}>
      {items.map((it) => (
        <Pressable
          key={it.label}
          accessibilityRole="tab"
          accessibilityState={{ selected: it.active }}
          onPress={it.onPress}
          style={{ flex: 1, borderRadius: 12, paddingVertical: 8, alignItems: "center", backgroundColor: it.active ? color.bg : "transparent" }}
        >
          <Text style={{ fontFamily: font.semibold, fontSize: 13, color: it.active ? color.ink : color.inkSoft }}>{it.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** The day being viewed, written out, and its week as seven cells (week-strip.tsx). */
function WeekStrip({ data, onPick }: { data: FoodDayV1; onPick: (day: string) => void }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const w = t.clientWidgets.weekStrip;
  const selected = data.day;
  const days = weekDaysOf(selected);
  const logged = new Set(data.logged_days ?? []);
  const longDate = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" });
  const heading = capitalize(longDate.format(parseDay(selected)));
  const monthYear = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(parseDay(selected));
  const narrow = new Intl.DateTimeFormat(locale, { weekday: "narrow" });

  const round = (d: string, label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.round, { backgroundColor: color.surface }]}>
      <NavIcon d={d} size={15} color={color.inkSoft} strokeWidth={2.2} />
    </Pressable>
  );

  return (
    <View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.kicker(color.inkFaint)}>{monthYear}</Text>
          <Text style={{ marginTop: 4, fontFamily: font.displayExtrabold, fontSize: 24, lineHeight: 30, color: color.ink }}>{heading}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {selected !== data.today ? (
            <Pressable accessibilityRole="button" onPress={() => onPick(data.today)} style={[styles.todayPill, { backgroundColor: color.surface }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{w.today}</Text>
            </Pressable>
          ) : null}
          {round("m15 6-6 6 6 6", w.prevWeek, () => onPick(shiftDay(selected, -7)))}
          {round("m9 6 6 6-6 6", w.nextWeek, () => onPick(shiftDay(selected, 7)))}
        </View>
      </View>
      <View style={{ marginTop: 16, flexDirection: "row", gap: 6 }}>
        {days.map((d) => {
          const date = parseDay(d);
          const isSelected = d === selected;
          const isToday = d === data.today;
          const hasLog = logged.has(d);
          const mark = isSelected ? alpha(color.accentFg, 0.6) : color.accent;
          return (
            <Pressable
              key={d}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={fill(w.dayAria, { date: longDate.format(date), status: hasLog ? w.logged : w.empty })}
              onPress={() => onPick(d)}
              style={[styles.dayCell, { backgroundColor: isSelected ? color.accent : color.surface }]}
            >
              <Text style={{ fontFamily: font.semibold, fontSize: 10, textTransform: "uppercase", color: isSelected ? alpha(color.accentFg, 0.7) : color.inkFaint }}>
                {narrow.format(date)}
              </Text>
              <Text style={{ fontFamily: font.bold, fontSize: 15, color: isSelected ? color.accentFg : color.ink }}>{date.getDate()}</Text>
              <View style={{ marginTop: 4, height: 4, borderRadius: 999, width: hasLog ? 16 : 4, backgroundColor: hasLog || isToday ? mark : "transparent" }} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** The day at a glance (nutrition-summary.tsx): goal and eaten, what is left with its bar, the three macro rings. */
function Summary({ data, totals }: { data: FoodDayV1; totals: MacrosV1 }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const [editing, setEditing] = useState(false);
  const f = t.clientApp.food;
  const target = data.target;
  const hasTarget = target.kcal > 0;
  const consumed = Math.round(totals.kcal);
  const remaining = Math.round(target.kcal - totals.kcal);
  const over = hasTarget && remaining < 0;
  const ratio = hasTarget ? Math.min(Math.max(totals.kcal / target.kcal, 0), 1) : 0;
  const source = data.plan_owner === "coach" ? f.setByCoach : data.plan_owner === "self" ? f.setByYou : f.noTarget;

  const tile = (label: string, value: string, foot: React.ReactNode) => (
    <View style={[styles.tile, { backgroundColor: color.bg }]}>
      <Text style={styles.kicker(color.inkFaint)}>{label}</Text>
      <Text style={{ marginTop: 4, fontFamily: font.displayExtrabold, fontSize: 24, lineHeight: 26, color: color.ink }}>
        {value}
        <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkFaint }}> kcal</Text>
      </Text>
      {foot}
    </View>
  );

  return (
    <>
      <Card style={{ gap: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Text numberOfLines={1} style={[styles.kicker(color.inkFaint), { flexShrink: 1 }]}>{data.plan_name ?? t.common.macros.todayTitle}</Text>
          <Pressable accessibilityRole="button" onPress={() => setEditing((v) => !v)} style={[styles.smallPill, { backgroundColor: color.bg }]}>
            <NavIcon d="M4 20h4l10-10-4-4L4 16zM13 7l4 4" size={15} color={color.accentInk} />
            <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{f.editTargets}</Text>
          </Pressable>
        </View>

        <View style={{ marginTop: 14, flexDirection: "row", gap: 10 }}>
          {tile(f.goal, hasTarget ? String(Math.round(target.kcal)) : "—", (
            <Text numberOfLines={1} style={{ marginTop: 6, fontFamily: font.regular, fontSize: 11, color: color.accentInk }}>{source}</Text>
          ))}
          {tile(f.consumed, String(consumed), hasTarget ? (
            <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{`${Math.round((totals.kcal / target.kcal) * 100)}%`}</Text>
          ) : null)}
        </View>

        <View style={{ marginTop: 18, flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <Text style={{ fontFamily: font.displayExtrabold, fontSize: 34, lineHeight: 36, color: over ? color.warn : color.ink }}>
            {hasTarget ? Math.abs(remaining) : consumed}
            <Text style={{ fontFamily: font.medium, fontSize: 13, color: color.inkFaint }}>{`  ${hasTarget ? (over ? f.kcalOver : f.kcalLeft) : "kcal"}`}</Text>
          </Text>
          {hasTarget ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{`0 – ${Math.round(target.kcal)}`}</Text> : null}
        </View>
        <View style={{ marginTop: 10, height: 10, borderRadius: 6, overflow: "hidden", backgroundColor: color.bg }}>
          <View style={{ height: "100%", borderRadius: 6, width: `${over ? 100 : ratio * 100}%`, backgroundColor: over ? color.warn : color.accent }} />
        </View>

        <View style={{ marginTop: 16, flexDirection: "row", gap: 10 }}>
          <MacroRing label={t.common.macros.protein} value={totals.protein} target={target.protein} />
          <MacroRing label={t.common.macros.carbs} value={totals.carbs} target={target.carbs} />
          <MacroRing label={t.common.macros.fat} value={totals.fat} target={target.fat} />
        </View>
      </Card>
      {editing ? <TargetsForm target={data.target} planOwner={data.plan_owner} onClose={() => setEditing(false)} /> : null}
    </>
  );
}

/** One macro as a tile: its label, a ring with the percentage, the grams against the target. Gold to the target, orange past it. */
function MacroRing({ label, value, target }: { label: string; value: number; target: number }) {
  const { color } = useTheme();
  const r = 27;
  const c = 2 * Math.PI * r;
  const hasTarget = target > 0;
  const ratio = hasTarget ? value / target : 0;
  const over = ratio > 1.05;
  const dash = c * Math.min(Math.max(ratio, 0), 1);
  return (
    <View style={[styles.ringTile, { backgroundColor: color.bg }]}>
      <Text numberOfLines={1} style={styles.kicker(color.inkFaint, 10)}>{label}</Text>
      <View style={{ width: 64, height: 64 }}>
        <Svg width={64} height={64} viewBox="0 0 64 64" style={{ transform: [{ rotate: "-90deg" }] }}>
          <Circle cx={32} cy={32} r={r} fill="none" stroke={color.line} strokeWidth={7} />
          {dash > 0 ? (
            <Circle cx={32} cy={32} r={r} fill="none" stroke={over ? color.warn : color.accent} strokeWidth={7} strokeLinecap="round" strokeDasharray={`${dash} ${c - dash}`} />
          ) : null}
        </Svg>
        <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
          <Text style={{ fontFamily: font.displayBold, fontSize: 13, color: color.ink }}>
            {hasTarget ? `${Math.round(ratio * 100)}%` : `${Math.round(value)} g`}
          </Text>
        </View>
      </View>
      <Text style={{ fontFamily: font.bold, fontSize: 14, color: color.ink }}>
        {Math.round(value)}
        <Text style={{ fontFamily: font.medium, fontSize: 11, color: color.inkFaint }}>{hasTarget ? ` / ${Math.round(target)} g` : " g"}</Text>
      </Text>
    </View>
  );
}

/** One meal (meal-card.tsx): what was logged, the plan, "ate as planned", "same as yesterday", and the "+". */
function MealCard({ slot, label, data, entries, busy, online }: {
  slot: MealSlotV1;
  label: string;
  data: FoodDayV1;
  entries: DiaryEntry[];
  busy: string | null;
  online: (key: string, work: () => Promise<{ ok: boolean; message?: string }>) => Promise<boolean>;
}) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const f = t.clientApp.food;
  const kcal = Math.round(sumMacros(entries).kcal);
  const planned = data.planned.find((m) => m.slot === slot && !m.extra) ?? null;
  const extras = data.planned.filter((m) => m.slot === slot && m.extra);
  const previous = data.previous_day?.slots[slot];

  const plannedBox = (title: string, meal: FoodDayV1["planned"][number], offerLog: boolean) => (
    <View key={meal.id} style={[styles.planBox, { backgroundColor: color.bg }]}>
      <Text style={styles.kicker(color.inkFaint)}>{title}</Text>
      <View style={{ marginTop: 6, gap: 4 }}>
        {meal.foods.map((p, i) => (
          <View key={`${p.name}-${i}`} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
            <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{p.name}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>{`${Math.round(p.grams)} g · ${Math.round(p.macros.kcal)} kcal`}</Text>
          </View>
        ))}
      </View>
      {offerLog && meal.foods.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy === meal.id}
          onPress={() => void online(meal.id, () => api.ateAsPlanned(slot, data.day, meal.extra ? meal.id : undefined))}
          style={[styles.goldPill, { backgroundColor: color.accent, opacity: busy === meal.id ? 0.5 : 1 }]}
        >
          <Text style={{ fontFamily: font.displayBold, fontSize: 12.5, color: color.accentFg }}>{busy === meal.id ? f.ateAsPlannedDone : f.ateAsPlanned}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <Card style={{ gap: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 1 }}>
          <NavIcon d={SLOT_ICON[slot]} size={28} color={color.accentInk} />
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{label}</Text>
            {entries.length > 0 ? (
              <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
                <Text style={{ fontFamily: font.semibold, color: color.ink }}>{kcal}</Text>
                {` kcal · ${entries.length === 1 ? f.oneItemLogged : fill(f.itemsLogged, { n: entries.length })}`}
              </Text>
            ) : null}
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${f.addFoods}: ${label}`}
          onPress={() => router.push({ pathname: "/food/add", params: { slot, day: data.day } })}
          style={[styles.plus, { backgroundColor: color.accent }]}
        >
          <NavIcon d="M12 5v14M5 12h14" size={16} color={color.accentFg} strokeWidth={2.4} />
        </Pressable>
      </View>

      {entries.length > 0 ? (
        <View style={{ marginTop: 10 }}>
          {entries.map((e, i) => (
            <EntryRow key={e.id ?? e.localId} e={e} first={i === 0} busy={busy} online={online} />
          ))}
        </View>
      ) : (
        <Text style={{ marginTop: 8, fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>{f.noFoodAdded}</Text>
      )}

      {entries.length === 0 && previous && previous.items > 0 && data.previous_day ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy === `copy:${slot}`}
          onPress={() => void online(`copy:${slot}`, () => api.copyMeal(slot, data.previous_day!.day, data.day))}
          style={[styles.smallPill, { marginTop: 10, alignSelf: "flex-start", backgroundColor: color.bg, opacity: busy === `copy:${slot}` ? 0.5 : 1 }]}
        >
          <NavIcon d="M8 8h11v11H8zM5 16V5h11" size={14} color={color.inkSoft} />
          <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>
            {busy === `copy:${slot}` ? f.copyingYesterday : fill(f.sameAsYesterday, { n: previous.items, kcal: Math.round(previous.kcal) })}
          </Text>
        </Pressable>
      ) : null}

      {planned && planned.foods.length > 0 ? plannedBox(f.coachPlanned, planned, entries.length === 0) : null}
      {extras.map((x) => plannedBox(fill(f.extraMeal, { name: x.name }), x, true))}
    </Card>
  );
}

/** A logged portion (food-entry.tsx): name and kcal, grams and macros, then Edit and ✕ (with a confirm). */
function EntryRow({ e, first, busy, online }: {
  e: DiaryEntry;
  first: boolean;
  busy: string | null;
  online: (key: string, work: () => Promise<{ ok: boolean; message?: string }>) => Promise<boolean>;
}) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const fe = t.clientWidgets.foodEntry;
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [grams, setGrams] = useState(String(e.grams));
  const [error, setError] = useState<string | null>(null);
  const pending = e.state === "pending" || (e.id !== null && busy === e.id);
  const initial = (label: string) => label.charAt(0).toUpperCase();
  const m = t.common.macros;
  const border = first ? null : { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: alpha(color.line, 0.6) };

  if (editing && e.id) {
    const id = e.id;
    const gramsNum = Number(grams.replace(",", "."));
    const valid = isValidPortionGrams(gramsNum);
    const per100 = { kcal: (e.macros.kcal * 100) / e.grams, protein: (e.macros.protein * 100) / e.grams, carbs: (e.macros.carbs * 100) / e.grams, fat: (e.macros.fat * 100) / e.grams };
    const preview = valid ? portionMacros(per100, gramsNum) : e.macros;
    return (
      <View style={[{ paddingVertical: 10 }, border]}>
        <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{e.food_name}</Text>
        <View style={{ marginTop: 8, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <TextInput
            value={grams}
            onChangeText={setGrams}
            keyboardType="decimal-pad"
            accessibilityLabel={fill(fe.editAria, { name: e.food_name })}
            style={[styles.gramsInput, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }]}
          />
          <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>g</Text>
          <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>
            {"→ "}
            <Text style={{ fontFamily: font.bold, color: color.ink }}>{preview.kcal}</Text>
            {` kcal · P${preview.protein}`}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={!valid || pending}
            onPress={async () => {
              setError(null);
              const ok = await online(id, () => api.updateFoodLog(id, gramsNum));
              if (ok) setEditing(false);
              else setError(fe.couldNotUpdate);
            }}
            style={{ borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: color.accent, opacity: !valid || pending ? 0.4 : 1 }}
          >
            <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.accentFg }}>{t.common.actions.save}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => { setEditing(false); setGrams(String(e.grams)); }} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
            <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkFaint }}>{t.common.actions.cancel}</Text>
          </Pressable>
        </View>
        {!valid ? <Text style={{ marginTop: 4, fontFamily: font.semibold, fontSize: 12, color: color.risk }}>{fill(t.clientWidgets.foodLogger.gramsRange, { max: MAX_PORTION_GRAMS })}</Text> : null}
        {error ? <Text style={{ marginTop: 4, fontFamily: font.semibold, fontSize: 12, color: color.risk }}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <View style={[{ paddingVertical: 10, opacity: pending ? 0.6 : 1 }, border]}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: font.medium, fontSize: 14, color: e.state === "refused" ? color.risk : color.ink }}>{e.food_name}</Text>
        <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>
          {Math.round(e.macros.kcal)}
          <Text style={{ fontFamily: font.medium, fontSize: 12, color: color.inkFaint }}> kcal</Text>
        </Text>
      </View>
      <View style={{ marginTop: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <Text style={{ flexShrink: 1, fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>
          {`${e.grams} g · ${initial(m.protein)} ${e.macros.protein} · ${initial(m.carbs)} ${e.macros.carbs} · ${initial(m.fat)} ${e.macros.fat}`}
          {e.state === "pending" ? ` · ${t.mobile.workout.waiting}` : ""}
          {e.state === "refused" && e.error ? ` · ${fill(t.mobile.workout.refused, { message: e.error })}` : ""}
        </Text>
        {e.id ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            {confirming ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  disabled={pending}
                  onPress={async () => {
                    const ok = await online(e.id!, () => api.deleteFoodLog(e.id!));
                    if (!ok) setConfirming(false);
                  }}
                  style={{ borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: color.risk }}
                >
                  <Text style={{ fontFamily: font.semibold, fontSize: 12, color: "#ffffff" }}>{t.common.actions.delete}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => setConfirming(false)}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkFaint }}>{fe.keep}</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable accessibilityRole="button" accessibilityLabel={fill(fe.editAria, { name: e.food_name })} onPress={() => setEditing(true)} hitSlop={8}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkFaint }}>{t.common.actions.edit}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={fill(fe.removeAria, { name: e.food_name })} onPress={() => setConfirming(true)} hitSlop={8}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkFaint }}>✕</Text>
                </Pressable>
              </>
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = {
  ...StyleSheet.create({
    // 110 at the bottom: clear of the floating tab bar.
    body: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 110, gap: 18 },
    round: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
    todayPill: { height: 36, borderRadius: 18, paddingHorizontal: 16, justifyContent: "center" },
    dayCell: { flex: 1, alignItems: "center", gap: 2, borderRadius: 16, paddingVertical: 10 },
    tile: { flex: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
    ringTile: { flex: 1, alignItems: "center", gap: 8, borderRadius: 16, paddingHorizontal: 8, paddingTop: 12, paddingBottom: 10 },
    smallPill: { height: 36, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 18, paddingHorizontal: 14 },
    plus: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
    planBox: { marginTop: 12, borderRadius: 16, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12 },
    goldPill: { marginTop: 10, alignSelf: "flex-start", height: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: "center" },
    gramsInput: { width: 96, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, fontFamily: font.regular, fontSize: 14 },
  }),
  kicker: (ink: string, size = 11) => ({ fontFamily: font.semibold, fontSize: size, letterSpacing: 0.6, textTransform: "uppercase" as const, color: ink }),
};
