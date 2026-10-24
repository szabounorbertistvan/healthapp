import type { DashboardV1, SessionCardV1 } from "@healthapp/api/v1";
import { MEAL_SLOTS_V1 } from "@healthapp/api/v1";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Bar, Button, Card, CardLabel, Chevron, Divider, Dot, ICON, NavIcon, T } from "@/components/ui";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";
import { parseDay, weekDaysOf } from "@/lib/week";

// The web's Today cards (components/today-dashboard.tsx), one for one: the week
// card (score ring, its four parts, the Mon–Sun strip, three stats), training,
// nutrition, habits, coach, and the community links. Same strings, same
// numbers (GET /api/v1/dashboard runs the page's own reads), same layout.

const FLAME = "M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-8 0 4-4 6-4 12 0 4 3 7 7 7z";

const web = (path: string) => () => void Linking.openURL(`${config.webUrl}${path}`);

function useNumbers() {
  const { locale } = useI18n();
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");
  return (v: number) => nf.format(Math.round(v));
}

/** A row that opens something: dot, title, sub, then the chevron or a right-hand element. */
function Row({ onPress, done, title, sub, right }: { onPress: () => void; done: boolean; title: string; sub?: string; right?: ReactNode }) {
  const { color } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: color.bg }]}>
      <Dot done={done} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T kind="heading" numberOfLines={1} style={done ? { color: color.inkSoft } : undefined}>{title}</T>
        {sub ? <T kind="faint" style={{ marginTop: 2, lineHeight: 17 }}>{sub}</T> : null}
      </View>
      {right ?? <Chevron />}
    </Pressable>
  );
}

// ---------- this week ----------

export function WeekCard({ d }: { d: DashboardV1 }) {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const x = t.clientApp.today;
  const [open, setOpen] = useState(false);
  const a = d.adherence;
  const tone = { on_track: color.accentInk, needs_attention: color.warn, at_risk: color.risk }[a.signal];
  const stroke = { on_track: color.accent, needs_attention: color.warn, at_risk: color.risk }[a.signal];
  const pct = Math.round(a.overall * 100);
  const days = weekDaysOf(d.today);
  const df = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  const range = `${df.format(parseDay(days[0]!))} – ${df.format(parseDay(days[6]!))}`;
  const pc = (v: number) => `${Math.round(v * 100)}%`;
  const planned = d.sessions.planned || 3;
  const parts = [
    { label: x.scoreParts.workouts, value: a.workout, text: `${d.sessions.done} / ${planned}` },
    { label: x.scoreParts.nutrition, value: a.nutrition, text: pc(a.nutrition) },
    { label: x.scoreParts.habits, value: a.habits, text: pc(a.habits) },
    { label: x.scoreParts.checkIn, value: a.checkin ? 1 : 0, text: a.checkin ? "100%" : "—" },
  ];
  const r = 39;
  const c = 2 * Math.PI * r;
  const delta = d.load.delta_pct;
  const deltaText = delta === null || d.load.this_week === 0 ? undefined : `${delta > 0 ? "+" : ""}${delta.toLocaleString(locale, { maximumFractionDigits: 0 })}%`;
  const deltaTone = d.load.direction === "increased" ? color.accentInk : d.load.direction === "decreased" ? color.warn : color.inkFaint;
  const done = new Set(d.workout_days);
  const narrow = new Intl.DateTimeFormat(locale, { weekday: "narrow" });

  return (
    <Card style={{ gap: 0 }}>
      <View style={styles.between}>
        <T kind="label">{x.weeklyScore}</T>
        <T kind="faint" style={{ fontSize: 12 }}>{range}</T>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 18, marginTop: 14 }}>
        <View style={{ width: 96, height: 96 }}>
          <Svg width={96} height={96} viewBox="0 0 96 96" style={{ transform: [{ rotate: "-90deg" }] }}>
            <Circle cx={48} cy={48} r={r} fill="none" stroke={color.bg} strokeWidth={9} />
            {pct > 0 ? (
              <Circle cx={48} cy={48} r={r} fill="none" stroke={stroke} strokeWidth={9} strokeLinecap="round" strokeDasharray={`${c * Math.min(1, a.overall)} ${c}`} />
            ) : null}
          </Svg>
          <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
            <Text style={{ fontFamily: font.displayExtrabold, fontSize: 22, color: color.ink }}>{pct}%</Text>
          </View>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 11 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontFamily: font.bold, fontSize: 16, color: tone }}>{t.common.signal[a.signal]}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={x.statusInfo}
              onPress={() => setOpen((v) => !v)}
              style={[styles.info, { borderColor: color.line }]}
            >
              <Text style={{ fontFamily: font.semibold, fontSize: 10, color: color.inkFaint }}>i</Text>
            </Pressable>
          </View>
          {open ? <T kind="faint" style={{ fontSize: 12, lineHeight: 16 }}>{x.statusInfo}</T> : null}
          {parts.map((p) => (
            <View key={p.label} style={{ gap: 2 }}>
              <View style={styles.between}>
                <T kind="soft" numberOfLines={1} style={{ fontSize: 12.5, flexShrink: 1 }}>{p.label}</T>
                <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.ink }}>{p.text}</Text>
              </View>
              <Bar ratio={p.value} />
            </View>
          ))}
        </View>
      </View>

      {d.nudge ? (
        <View style={{ marginTop: 12, borderRadius: 14, backgroundColor: color.riskSoft, paddingHorizontal: 12, paddingVertical: 10 }}>
          <Text style={{ fontFamily: font.regular, fontSize: 12.5, lineHeight: 17, color: color.risk }}>{d.nudge}</Text>
        </View>
      ) : null}

      <View style={{ flexDirection: "row", gap: 6, marginTop: 16 }}>
        {days.map((day) => {
          const isToday = day === d.today;
          const trained = done.has(day);
          const past = day < d.today;
          const bg = isToday ? color.accent : trained ? color.accentSoft : color.bg;
          const ink = isToday ? color.accentFg : trained ? color.accentInk : color.inkFaint;
          return (
            <View key={day} style={[styles.day, { backgroundColor: bg, opacity: past && !trained && !isToday ? 0.7 : 1 }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 10, color: ink, textTransform: "uppercase" }}>{narrow.format(parseDay(day))}</Text>
              <Text style={{ fontFamily: font.bold, fontSize: 14, color: ink }}>{parseDay(day).getDate()}</Text>
              <View style={{ height: 3, width: 16, borderRadius: 999, backgroundColor: trained ? (isToday ? color.accentFg : color.accent) : "transparent" }} />
            </View>
          );
        })}
      </View>

      <View style={{ marginTop: 16 }}>
        <Divider />
      </View>
      <View style={{ flexDirection: "row", paddingTop: 14 }}>
        <Stat onPress={() => router.navigate("/workout")} label={x.workouts} value={String(d.sessions.done)} unit={`/ ${planned}`} />
        <View style={[styles.vrule, { backgroundColor: color.line }]} />
        <Stat onPress={web("/streak")} label={x.streak} value={String(d.streak_days)} unit={d.streak_days === 1 ? x.day : x.days} />
        <View style={[styles.vrule, { backgroundColor: color.line }]} />
        <Stat onPress={web("/today?week=current#weekly-report")} label={t.common.trainingLoad.short} value={String(d.load.this_week)} unit={deltaText} unitColor={deltaTone} />
      </View>
    </Card>
  );
}

function Stat({ onPress, label, value, unit, unitColor }: { onPress: () => void; label: string; value: string; unit?: string; unitColor?: string }) {
  const { color } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ flex: 1, alignItems: "center", paddingHorizontal: 6 }}>
      <T kind="label" numberOfLines={1} style={{ fontSize: 10 }}>{label}</T>
      <Text style={{ marginTop: 2, fontFamily: font.displayBold, fontSize: 20, color: color.ink }}>
        {value}
        {unit ? <Text style={{ fontFamily: font.medium, fontSize: 11.5, color: unitColor ?? color.inkFaint }}>{` ${unit}`}</Text> : null}
      </Text>
    </Pressable>
  );
}

// ---------- the fitness score ----------

export function FitnessCard({ d }: { d: DashboardV1 }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const f = t.common.fitnessScore;
  const s = d.fitness;
  if (!s) return null;
  const bandTone = s.band === "developing" || s.band === "strong_activity" ? color.accentInk : color.inkSoft;
  return (
    <Card style={{ gap: 0 }}>
      <View style={styles.between}>
        <T kind="label">{f.title}</T>
        <T kind="faint" style={{ fontSize: 11 }}>{f.last28Days}</T>
      </View>
      <View style={{ marginTop: 8 }}>
        {s.status === "building" ? (
          <>
            <Text style={{ fontFamily: font.displayExtrabold, fontSize: 20, color: color.ink }}>{f.building}</Text>
            <T kind="soft" style={{ marginTop: 8, lineHeight: 19 }}>{f.buildingHint}</T>
            <T kind="faint" style={{ marginTop: 4, fontSize: 12 }}>{fill(f.buildingProgress, { done: s.completed_workouts, needed: s.min_workouts })}</T>
          </>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 12 }}>
            <Text style={{ fontFamily: font.displayExtrabold, fontSize: 40, color: color.ink }}>{s.score}</Text>
            <Text style={{ fontFamily: font.semibold, fontSize: 16, color: bandTone }}>
              {s.band ? f.band[s.band as keyof typeof f.band] ?? s.band : f.building}
            </Text>
          </View>
        )}
      </View>
      <Pressable accessibilityRole="link" onPress={web("/fitness-score")} style={{ marginTop: 14 }}>
        <T kind="accent" style={{ fontSize: 12.5 }}>{`${f.viewDetails} →`}</T>
      </Pressable>
    </Card>
  );
}

// ---------- training ----------

function SessionMeta({ session, lead }: { session: SessionCardV1; lead: string }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const n = useNumbers();
  return (
    <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12.5, lineHeight: 17, color: color.inkFaint }}>
      {`${lead.charAt(0).toUpperCase()}${lead.slice(1)} · ${session.sets} ${t.clientApp.workoutDay.sets} · ${n(session.volume_kg)} kg`}
      {session.prs > 0 ? (
        <Text style={{ fontFamily: font.semibold, color: color.accentInk }}>
          {` · ${session.prs} ${session.prs === 1 ? t.clientApp.workoutDay.prOne : t.clientApp.workoutDay.prs}`}
        </Text>
      ) : null}
    </Text>
  );
}

export function TrainingCard({ d }: { d: DashboardV1 }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const x = t.clientApp.today;
  const w = t.clientApp.workout;
  const next = d.next;
  const doneToday = d.done_today;
  const previous = d.recent.filter((s) => s.id !== doneToday?.id);
  const inProgress = next !== null && !next.completed && next.logged > 0;
  const programNote = next ? (next.is_own ? w.byYou : w.byCoach) : null;
  const df = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" });
  const PREVIEW = 4;

  return (
    <Card flush>
      <CardLabel right={next && !doneToday ? `${next.program_name} · ${programNote}` : undefined}>{t.common.nav.training}</CardLabel>

      <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18 }}>
        {doneToday ? (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Dot done />
              <T kind="display" numberOfLines={1} style={{ flex: 1 }}>{doneToday.day_name}</T>
            </View>
            <SessionMeta session={doneToday} lead={doneToday.duration_min !== null ? `${x.doneToday} · ${doneToday.duration_min} min` : x.doneToday} />
            <View style={{ marginTop: 12, alignSelf: "flex-start" }}>
              <Button kind="quiet" height={34} label={t.common.shareCard.view} onPress={() => doneToday.day_id && router.push({ pathname: "/workout/[dayId]", params: { dayId: doneToday.day_id } })} />
            </View>
          </>
        ) : next ? (
          <>
            <T kind="display">{next.day_name}</T>
            <T kind="faint" style={{ marginTop: 2 }}>
              {inProgress ? fill(x.setsLogged, { done: next.logged, total: next.total_sets }) : `${x.nextUp} · ${fill(w.exercisesCount, { count: next.exercises.length })}`}
            </T>
            <View style={{ marginTop: 12, gap: 6 }}>
              {next.exercises.slice(0, PREVIEW).map((e) => (
                <View key={e.id} style={{ flexDirection: "row", alignItems: "baseline", gap: 12 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.medium, fontSize: 13, color: color.ink }}>{e.name}</Text>
                  <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{`${e.sets} × ${e.reps}${e.measure === "time" ? " s" : ""}`}</Text>
                  <Text style={{ minWidth: 56, textAlign: "right", fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>{e.weight || "—"}</Text>
                </View>
              ))}
              {next.exercises.length > PREVIEW ? <T kind="faint">{fill(w.moreExercises, { count: next.exercises.length - PREVIEW })}</T> : null}
            </View>
            <View style={{ marginTop: 16 }}>
              <Button
                label={inProgress ? t.clientApp.workoutDay.continueWorkout : t.clientApp.workoutDay.start}
                icon={ICON.chevron}
                onPress={() => router.push({ pathname: "/workout/[dayId]/log", params: { dayId: next.day_id } })}
              />
            </View>
          </>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => (d.has_coach ? router.navigate("/workout") : web("/workout/build")())} style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Dot done={false} />
            <T kind="faint" style={{ flex: 1, lineHeight: 17 }}>{d.has_coach ? x.noProgram : x.noProgramSolo}</T>
            <Chevron />
          </Pressable>
        )}
      </View>

      {previous.length > 0 ? (
        <>
          <Divider />
          <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16 }}>
            <T kind="label" style={{ fontSize: 10 }}>{x.recent}</T>
            <View style={{ marginTop: 6, gap: 10 }}>
              {previous.map((s) => (
                <Pressable key={s.id} accessibilityRole="button" onPress={() => (s.day_id ? router.push({ pathname: "/workout/[dayId]", params: { dayId: s.day_id } }) : router.navigate("/workout"))}>
                  <T kind="heading" numberOfLines={1} style={{ fontSize: 13.5 }}>{s.day_name}</T>
                  <SessionMeta session={s} lead={df.format(new Date(s.at))} />
                </Pressable>
              ))}
            </View>
          </View>
        </>
      ) : null}

      {d.streak ? (
        <>
          <Divider />
          <StreakRow streak={d.streak} />
        </>
      ) : null}
    </Card>
  );
}

function StreakRow({ streak }: { streak: NonNullable<DashboardV1["streak"]> }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const s = t.common.streaks;
  const none = streak.current === 0;
  const title = none ? s.startTitle : streak.current === 1 ? s.dayStreakOne : fill(s.dayStreak, { count: streak.current });
  const consecutive = streak.current === 1 ? s.consecutiveDaysOne : fill(s.consecutiveDays, { count: streak.current });
  const body = none ? s.startBody : streak.active_today ? consecutive : streak.active_yesterday ? s.keepGoing : consecutive;
  return (
    <Pressable accessibilityRole="link" onPress={web("/streak")} style={({ pressed }) => [styles.row, pressed && { backgroundColor: color.bg }]}>
      <View style={[styles.iconDot, { backgroundColor: color.accentSoft }]}>
        <NavIcon d={FLAME} size={16} color={color.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T kind="heading">{title}</T>
        <T kind="faint" style={{ marginTop: 2, lineHeight: 17 }}>{body}</T>
      </View>
      {!none && streak.longest > 0 ? <T kind="faint">{streak.longest === 1 ? s.bestOne : fill(s.best, { count: streak.longest })}</T> : null}
      <Chevron />
    </Pressable>
  );
}

// ---------- nutrition ----------

function MacroBar({ label, value, target }: { label: string; value: number; target: number }) {
  const { color } = useTheme();
  const n = useNumbers();
  const over = target > 0 && value > target * 1.05;
  return (
    <View style={{ gap: 2 }}>
      <View style={styles.between}>
        <T kind="soft" numberOfLines={1} style={{ fontSize: 12.5, flexShrink: 1 }}>{label}</T>
        <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.ink }}>{`${n(value)} / ${n(target)} g`}</Text>
      </View>
      <Bar ratio={target > 0 ? value / target : 0} over={over} />
    </View>
  );
}

export function NutritionCard({ d }: { d: DashboardV1 }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const n = useNumbers();
  const x = t.clientApp.today;
  const nut = d.nutrition;
  const kcalTarget = nut.target.kcal;
  const kcal = nut.totals.kcal;
  const hasTarget = kcalTarget > 0;
  const over = hasTarget && kcal > kcalTarget * 1.05;
  const diff = Math.abs(kcalTarget - kcal);
  const planNote = nut.plan_owner === "coach" ? t.clientApp.workout.byCoach : nut.plan_owner === "self" ? t.clientApp.workout.byYou : null;
  const bySlot = MEAL_SLOTS_V1.map((slot) => {
    const entries = nut.entries.filter((e) => e.slot === slot);
    return { slot, names: entries.map((e) => e.food_name).join(", "), kcal: entries.reduce((s, e) => s + e.kcal, 0) };
  });

  return (
    <Card flush>
      <CardLabel right={planNote ? `${nut.plan_name ? `${nut.plan_name} · ` : ""}${planNote}` : undefined}>{t.common.nav.nutrition}</CardLabel>
      <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18 }}>
        <View style={[styles.between, { alignItems: "baseline" }]}>
          <Text style={{ fontFamily: font.displayExtrabold, fontSize: 19, color: color.ink }}>
            {n(kcal)}
            {hasTarget ? <Text style={{ color: color.inkFaint }}>{` / ${n(kcalTarget)}`}</Text> : null}
            <Text style={{ fontFamily: font.medium, fontSize: 12.5, color: color.inkFaint }}> kcal</Text>
          </Text>
          {hasTarget ? (
            <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: over ? color.warn : color.inkFaint }}>{`${n(diff)} ${over ? x.over : x.left}`}</Text>
          ) : (
            <T kind="faint">{x.noTargetYet}</T>
          )}
        </View>
        {hasTarget ? (
          <>
            <View style={{ marginTop: 8 }}>
              <Bar ratio={kcal / kcalTarget} over={over} height={5} />
            </View>
            <View style={{ marginTop: 14, gap: 11 }}>
              <MacroBar label={t.common.macros.protein} value={nut.totals.protein} target={nut.target.protein} />
              <MacroBar label={t.common.macros.carbs} value={nut.totals.carbs} target={nut.target.carbs} />
              <MacroBar label={t.common.macros.fat} value={nut.totals.fat} target={nut.target.fat} />
            </View>
          </>
        ) : null}
      </View>
      <Divider />
      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16 }}>
        <T kind="label" style={{ fontSize: 10 }}>{x.meals}</T>
        <View style={{ marginTop: 8, gap: 13 }}>
          {bySlot.map((m) => (
            <Pressable key={m.slot} accessibilityRole="button" onPress={() => router.navigate("/food")} style={{ flexDirection: "row", alignItems: "baseline", gap: 12 }}>
              <Text numberOfLines={1} style={{ width: 88, fontFamily: font.medium, fontSize: 13, color: color.ink }}>{t.clientApp.food[m.slot]}</Text>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.regular, fontSize: 13, color: m.names ? color.inkSoft : color.inkFaint }}>{m.names || x.nothingYet}</Text>
              <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>{m.names ? `${n(m.kcal)} kcal` : "—"}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ marginTop: 14 }}>
          <Button kind="quiet" height={40} label={`+  ${x.logFood}`} onPress={() => router.navigate("/food")} />
        </View>
      </View>
    </Card>
  );
}

// ---------- habits, coach, community ----------

export function HabitsCard({ d }: { d: DashboardV1 }) {
  const { t } = useI18n();
  const x = t.clientApp.today;
  const done = d.habits.filter((h) => h.done_today).length;
  return (
    <Card flush>
      <CardLabel right={d.habits.length > 0 ? `${done}/${d.habits.length}` : undefined}>{t.common.nav.habits}</CardLabel>
      <View style={{ paddingTop: 6, paddingBottom: 6 }}>
        {d.habits.length > 0 ? (
          d.habits.map((h) => <Row key={h.id} onPress={() => router.navigate("/habits")} done={h.done_today} title={h.name} />)
        ) : (
          <Row onPress={() => router.navigate("/habits")} done={false} title="" sub={x.noHabitsYet} />
        )}
      </View>
    </Card>
  );
}

export function CoachCard({ d }: { d: DashboardV1 }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const x = t.clientApp.today;
  const submitted = d.check_in.submitted;
  return (
    <Card flush>
      <CardLabel>{d.has_coach ? t.common.nav.coach : t.common.nav.checkIn}</CardLabel>
      <View style={{ marginTop: 8 }}>
        <Row
          onPress={() => router.push("/check-in")}
          done={submitted}
          title={x.weeklyCheckIn}
          sub={submitted ? x.checkInSubmitted : x.checkInNotSubmitted}
          right={
            submitted ? undefined : (
              <View style={{ borderRadius: 999, backgroundColor: color.warnSoft, paddingHorizontal: 10, paddingVertical: 2 }}>
                <Text style={{ fontFamily: font.bold, fontSize: 11, color: color.warn }}>{x.due}</Text>
              </View>
            )
          }
        />
        {d.check_in.coach_feedback ? (
          <>
            <Divider />
            <View style={{ padding: 20, paddingVertical: 14 }}>
              <View style={{ borderRadius: 16, backgroundColor: color.accentSoft, paddingHorizontal: 16, paddingVertical: 14 }}>
                <T kind="label" style={{ color: color.accentInk }}>{x.fromYourCoach}</T>
                <T kind="soft" style={{ marginTop: 6, fontSize: 13.5, lineHeight: 20 }}>{d.check_in.coach_feedback}</T>
              </View>
            </View>
          </>
        ) : null}
        {d.unread_from_coach > 0 ? (
          <>
            <Divider />
            <Row
              onPress={() => router.push("/messages")}
              done={false}
              title={d.unread_from_coach === 1 ? x.unreadMessageOne : fill(x.unreadMessages, { count: d.unread_from_coach })}
              sub={x.openConversation}
            />
          </>
        ) : null}
      </View>
    </Card>
  );
}

function LinkRow({ icon, label, meta, onPress }: { icon: string; label: string; meta?: string; onPress: () => void }) {
  const { color } = useTheme();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: color.bg }]}>
      <View style={[styles.linkIcon, { backgroundColor: color.accentSoft }]}>
        <NavIcon d={icon} size={17} color={color.accentInk} />
      </View>
      <T kind="heading" numberOfLines={1} style={{ flex: 1 }}>{label}</T>
      {meta ? <T kind="faint">{meta}</T> : null}
      <Chevron />
    </Pressable>
  );
}

export function CommunityCard({ d }: { d: DashboardV1 }) {
  const { t } = useI18n();
  const x = t.clientApp.today;
  return (
    <Card flush>
      <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
        <T kind="label">{x.community}</T>
      </View>
      <View style={{ marginTop: 8 }}>
        <LinkRow icon={ICON.leaderboards} label={t.common.leaderboards.title} meta={d.community.leaderboard_rank ? `#${d.community.leaderboard_rank}` : undefined} onPress={web("/leaderboards")} />
        <Divider />
        <LinkRow icon={ICON.challenges} label={t.common.challenges.title} meta={`${d.community.active_challenges} ${x.active}`} onPress={web("/challenges")} />
        <Divider />
        <LinkRow icon={ICON.feed} label={t.common.social.feed} onPress={web("/feed")} />
      </View>
    </Card>
  );
}

export function WeeklyReportRow() {
  const { t } = useI18n();
  const { color } = useTheme();
  return (
    <Pressable accessibilityRole="link" onPress={web("/today?week=current#weekly-report")}>
      <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 20 }}>
        <Text style={{ fontFamily: font.semibold, fontSize: 14.5, color: color.ink }}>{t.clientApp.today.weeklyReport}</Text>
        <NavIcon d={ICON.down} size={16} color={color.inkFaint} />
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  info: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  day: { flex: 1, alignItems: "center", gap: 3, borderRadius: 14, paddingVertical: 8 },
  vrule: { width: StyleSheet.hairlineWidth * 2, opacity: 0.6 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: 14 },
  iconDot: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  linkIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
});
