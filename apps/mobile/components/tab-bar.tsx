import { BlurView } from "expo-blur";
import { router, type Tabs } from "expo-router";
import { useEffect, useState, type ComponentProps } from "react";
import { BackHandler, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Divider, Glass, ICON, NavIcon, T } from "@/components/ui";
import { signOut } from "@/lib/auth";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { alpha, font, useTheme } from "@/lib/theme";

// The web's phone navigation (components/client-nav.tsx ClientTabBar and
// nav-links.tsx CoachTabBar): a floating glass pane a thumb's width off the
// bottom edge, four sections plus "More", the active one in gold with a short
// bar under its label; "More" opens a sheet with every other section. A
// section the app has natively opens its screen; the rest open the same page
// on voinic.fit.

/** What expo-router hands a custom tab bar (React Navigation's BottomTabBarProps). */
type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

type NavKey = "today" | "training" | "nutrition" | "habits" | "dashboard" | "checkIns" | "messages" | "myTraining";

/** One cell of the bar: which tab route it is, its label key and icon. */
type TabItem = { route: string; key: NavKey; icon: string };

export const CLIENT_TABS: TabItem[] = [
  { route: "index", key: "today", icon: ICON.today },
  { route: "workout", key: "training", icon: ICON.training },
  { route: "food", key: "nutrition", icon: ICON.nutrition },
  { route: "habits", key: "habits", icon: ICON.habits },
];

export const COACH_TABS: TabItem[] = [
  { route: "clients", key: "dashboard", icon: ICON.dashboard },
  { route: "inbox", key: "checkIns", icon: ICON.checkIn },
  { route: "chats", key: "messages", icon: ICON.messages },
  { route: "index", key: "myTraining", icon: ICON.myTraining },
];

type SheetKey =
  | "programs" | "progress" | "checkIn" | "challenges" | "gyms" | "achievements" | "feed" | "saved"
  | "notifications" | "coach" | "bookings" | "account" | "library" | "nutrition" | "marketplace" | "settings"
  | "training" | "habits" | "findCoach";

/** A section in the sheet: a native route, or a path on the web. */
type SheetItem = { key: SheetKey; icon: string; route?: string; web?: string };

const CLIENT_SHEET: SheetItem[] = [
  { key: "programs", icon: ICON.programs, route: "/routines" },
  { key: "progress", icon: ICON.progress, route: "/progress" },
  { key: "checkIn", icon: ICON.checkIn, route: "/check-in" },
  { key: "challenges", icon: ICON.challenges, route: "/challenges" },
  { key: "gyms", icon: ICON.gyms, route: "/gyms" },
  { key: "achievements", icon: ICON.achievements, route: "/achievements" },
  { key: "feed", icon: ICON.feed, route: "/feed" },
  { key: "saved", icon: ICON.saved, route: "/saved" },
  { key: "notifications", icon: ICON.notifications, route: "/notifications" },
  { key: "coach", icon: ICON.coach, route: "/messages" },
  { key: "findCoach", icon: ICON.coach, route: "/coaches" },
  { key: "bookings", icon: ICON.bookings, route: "/bookings" },
  { key: "account", icon: ICON.account, route: "/more" },
];

const COACH_SHEET: SheetItem[] = [
  { key: "programs", icon: ICON.training, route: "/coach/programs" },
  { key: "library", icon: ICON.library, route: "/exercises" },
  { key: "nutrition", icon: ICON.nutrition, route: "/coach/nutrition" },
  { key: "marketplace", icon: ICON.marketplace, route: "/coach/marketplace" },
  { key: "training", icon: ICON.training, route: "/workout" },
  { key: "habits", icon: ICON.habits, route: "/habits" },
  { key: "progress", icon: ICON.progress, route: "/progress" },
  { key: "notifications", icon: ICON.notifications, route: "/notifications" },
  { key: "settings", icon: ICON.account, route: "/more" },
];

export function GlassTabBar({ state, coach }: BottomTabBarProps & { coach: boolean }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const tabs = coach ? COACH_TABS : CLIENT_TABS;
  const current = state.routes[state.index]?.name;
  const restActive = !tabs.some((tab) => tab.route === current);

  const cell = (active: boolean, icon: string, label: string, onPress: () => void, strokeWidth = 1.8) => (
    <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={styles.cell}>
      <NavIcon d={icon} size={22} color={active ? color.accentInk : color.inkFaint} strokeWidth={strokeWidth} />
      <Text numberOfLines={1} style={[styles.cellLabel, { color: active ? color.accentInk : color.inkFaint }]}>
        {label}
      </Text>
      <View style={[styles.cellBar, { backgroundColor: active ? color.accent : "transparent" }]} />
    </Pressable>
  );

  return (
    <>
      <MoreSheet open={open} onClose={() => setOpen(false)} items={coach ? COACH_SHEET : CLIENT_SHEET} current={current} />
      <View pointerEvents="box-none" style={[styles.barWrap, { bottom: Math.max(12, insets.bottom), left: 12 + insets.left, right: 12 + insets.right }]}>
        <BlurView intensity={30} tint="default" style={styles.blur}>
          <Glass pane="strong" radius={26} style={styles.bar}>
            {tabs.map((tab) =>
              cell(current === tab.route, tab.icon, t.common.nav[tab.key], () => {
                setOpen(false);
                router.navigate((tab.route === "index" ? "/" : `/${tab.route}`) as never);
              }),
            )}
            {cell(open || restActive, ICON.more, t.common.nav.more, () => setOpen((v) => !v), 2.6)}
          </Glass>
        </BlurView>
      </View>
    </>
  );
}

/** The phone's "More" sheet (client-nav.tsx): every other section, then the account controls. */
// A layer under the bar, not a modal: the bar stays on top and tappable while the
// sheet is open, as on the web (client-nav.tsx); Android's back button closes it.
function MoreSheet({ open, onClose, items, current }: { open: boolean; onClose: () => void; items: SheetItem[]; current?: string }) {
  const { t, locale, setLocale } = useI18n();
  const { color } = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    // Android's back button closes the sheet; there is no such button on the web preview.
    if (!open || Platform.OS === "web") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  const go = (item: SheetItem) => {
    onClose();
    if (item.route) router.push(item.route as never);
    else if (item.web) void Linking.openURL(`${config.webUrl}${item.web}`);
  };

  if (!open) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable accessibilityLabel={t.common.moreSheet.close} onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: alpha(color.bg, 0.8) }]} />
      <View style={styles.sheetWrap} pointerEvents="box-none">
        <Glass pane="strong" radius={24} style={[styles.sheet, { paddingBottom: 88 + Math.max(12, insets.bottom), backgroundColor: alpha(color.surface, 0.96) }]}>
          <View style={[styles.grabber, { backgroundColor: color.line }]} />
          <T kind="label" style={{ paddingHorizontal: 4, marginBottom: 8 }}>{t.common.moreSheet.title}</T>
          <ScrollView style={{ maxHeight: 520 }}>
            {items.map((item) => {
              const active = Boolean(item.route) && `/${current}` === item.route;
              return (
              <Pressable
                key={item.key}
                accessibilityRole="link"
                accessibilityState={{ selected: active }}
                onPress={() => go(item)}
                style={({ pressed }) => [styles.sheetRow, (active || pressed) && { backgroundColor: color.accentSoft }]}
              >
                <NavIcon d={item.icon} size={20} color={active ? color.accentInk : color.inkSoft} />
                <Text style={[styles.sheetLabel, { color: active ? color.accentInk : color.inkSoft, fontFamily: active ? font.semibold : font.medium }]}>{item.key === "findCoach" ? t.coachProfile.discovery.explore : t.common.nav[item.key]}</Text>
                {item.web ? <NavIcon d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" size={14} color={color.inkFaint} /> : null}
              </Pressable>
              );
            })}
            <Divider />
            <View style={styles.prefs}>
              <View style={[styles.segment, { borderColor: color.line }]}>
                {(["en", "ro"] as const).map((l) => (
                  <Pressable
                    key={l}
                    accessibilityRole="button"
                    accessibilityState={{ selected: locale === l }}
                    onPress={() => setLocale(l)}
                    style={[styles.segmentItem, { backgroundColor: locale === l ? color.accent : "transparent" }]}
                  >
                    <Text style={{ fontFamily: font.bold, fontSize: 13, color: locale === l ? color.accentFg : color.inkSoft }}>{l.toUpperCase()}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onClose();
                  void signOut();
                }}
                style={styles.signOut}
              >
                <NavIcon d={ICON.signOut} size={18} color={color.inkSoft} />
                <Text style={[styles.sheetLabel, { color: color.inkSoft, flex: 0 }]}>{t.common.signOut.action}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Glass>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  barWrap: { position: "absolute" },
  blur: { borderRadius: 26, overflow: "hidden" },
  bar: { flexDirection: "row", paddingHorizontal: 6, paddingVertical: 6 },
  cell: { flex: 1, height: 52, alignItems: "center", justifyContent: "center", gap: 2 },
  cellLabel: { fontFamily: font.semibold, fontSize: 10.5, letterSpacing: 0.1 },
  cellBar: { marginTop: 1, height: 2, width: 16, borderRadius: 999 },
  sheetWrap: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, padding: 16 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 999, marginBottom: 12 },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, borderRadius: 16, paddingHorizontal: 12 },
  sheetLabel: { flex: 1, fontFamily: font.medium, fontSize: 14 },
  prefs: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 12, paddingHorizontal: 4 },
  segment: { flexDirection: "row", borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  segmentItem: { paddingHorizontal: 14, height: 38, alignItems: "center", justifyContent: "center" },
  signOut: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 8 },
});
