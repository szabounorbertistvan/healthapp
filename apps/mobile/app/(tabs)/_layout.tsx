import { router, Tabs, useIsFocused, usePathname } from "expo-router";
import { useEffect, useRef, type ReactNode } from "react";
import { View } from "react-native";
import { CompleteProfile, needsProfile } from "@/components/complete-profile";
import { GlassTabBar } from "@/components/tab-bar";
import { isCoachRole, useMe } from "@/lib/role";

// The web's phone navigation (components/client-nav.tsx, nav-links.tsx):
// a client gets Today · Training · Nutrition · Habits · More; a coach gets
// Dashboard · Check-ins · Messages · My training · More. Every screen below is
// a tab route; the bar (components/tab-bar.tsx) shows the role's four and
// opens the rest from "More", so a link or a notification can reach any of them.
export default function TabsLayout() {
  const me = useMe();
  const coach = isCoachRole(me.data?.data.role);
  const pathname = usePathname();
  const landed = useRef(false);
  // A coach opens on the Dashboard, as /dashboard on the web — once, when the
  // app starts on Today; after that Today is their own "My training".
  useEffect(() => {
    if (landed.current || !me.data) return;
    landed.current = true;
    if (coach && pathname === "/") router.replace("/clients");
  }, [coach, me.data, pathname]);
  // no username yet, or the current consent missing: that step first (/complete-profile)
  if (me.data && needsProfile(me.data.data)) return <CompleteProfile me={me.data.data} />;
  return (
    <Tabs
      tabBar={(props) => <GlassTabBar {...props} coach={coach} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: "transparent" } }}
      screenLayout={({ children }) => <FocusedOnly>{children}</FocusedOnly>}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="workout" />
      <Tabs.Screen name="food" />
      <Tabs.Screen name="habits" />
      <Tabs.Screen name="progress" />
      <Tabs.Screen name="more" />
      <Tabs.Screen name="clients" />
      <Tabs.Screen name="inbox" />
      <Tabs.Screen name="chats" />
    </Tabs>
  );
}

/**
 * The scenes are transparent so the Backdrop's light shows through, which
 * means a tab left behind would show through too: the navigator only moves it
 * under the focused one. Hidden instead — mounted, so its state and scroll stay.
 */
function FocusedOnly({ children }: { children: ReactNode }) {
  const focused = useIsFocused();
  return <View style={{ flex: 1, display: focused ? "flex" : "none" }}>{children}</View>;
}
