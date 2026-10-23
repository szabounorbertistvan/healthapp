import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

type Icon = ComponentProps<typeof Ionicons>["name"];

// The spec's client tabs (C-screens): Today · Workout · Food · Progress · More.
export default function TabsLayout() {
  const { t } = useI18n();
  const { color } = useTheme();
  const tab = (title: string, icon: Icon) => ({
    title,
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
      <Tabs.Screen name="index" options={tab(t.mobile.tabs.today, "today-outline")} />
      <Tabs.Screen name="workout" options={tab(t.mobile.tabs.workout, "barbell-outline")} />
      <Tabs.Screen name="food" options={tab(t.mobile.tabs.food, "restaurant-outline")} />
      <Tabs.Screen name="progress" options={tab(t.mobile.tabs.progress, "trending-up-outline")} />
      <Tabs.Screen name="more" options={tab(t.mobile.tabs.more, "menu-outline")} />
    </Tabs>
  );
}
