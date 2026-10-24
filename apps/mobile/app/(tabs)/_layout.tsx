import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";
import { useI18n } from "@/lib/i18n";
import { isCoachRole, useMe } from "@/lib/role";
import { useTheme } from "@/lib/theme";

type Icon = ComponentProps<typeof Ionicons>["name"];

// The spec's client tabs (C-screens): Today · Workout · Food · Progress · More.
// A coach gets the coach-on-the-go tabs instead — Clients · Inbox · Chats ·
// My training · More — and reaches Workout / Food / Progress from More: a
// coach trains too (CLAUDE.md: "(client) is not client-only"). Hidden tabs keep
// their routes, so a link or a notification can still open them.
export default function TabsLayout() {
  const { t } = useI18n();
  const { color } = useTheme();
  const coach = isCoachRole(useMe().data?.data.role);
  const tab = (title: string, icon: Icon, shown = true) => ({
    title,
    href: shown ? undefined : null,
    tabBarIcon: ({ color: tint, size }: { color: ColorValue; size: number }) => (
      // the tints set below are hex strings
      <Ionicons name={icon} color={tint as string} size={size} />
    ),
  });
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.accent,
        tabBarInactiveTintColor: color.inkFaint,
        tabBarStyle: { backgroundColor: color.surface, borderTopColor: color.line },
        sceneStyle: { backgroundColor: color.bg },
      }}
    >
      <Tabs.Screen name="clients" options={tab(t.mobile.coach.clients, "people-outline", coach)} />
      <Tabs.Screen name="inbox" options={tab(t.mobile.coach.inbox, "file-tray-full-outline", coach)} />
      <Tabs.Screen name="chats" options={tab(t.mobile.coach.chats, "chatbubbles-outline", coach)} />
      <Tabs.Screen name="index" options={tab(coach ? t.mobile.training.title : t.mobile.tabs.today, "today-outline")} />
      <Tabs.Screen name="workout" options={tab(t.mobile.tabs.workout, "barbell-outline", !coach)} />
      <Tabs.Screen name="food" options={tab(t.mobile.tabs.food, "restaurant-outline", !coach)} />
      <Tabs.Screen name="progress" options={tab(t.mobile.tabs.progress, "trending-up-outline", !coach)} />
      <Tabs.Screen name="more" options={tab(t.mobile.tabs.more, "menu-outline")} />
    </Tabs>
  );
}
