import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, type ReactNode } from "react";
import { Platform } from "react-native";
import { routeFor } from "./push-route";
import { enablePush } from "./push-token";
import { useAuth } from "./auth";
import { useI18n, type Dictionary } from "./i18n";

export { disablePush, enablePush, type PushState } from "./push-token";
export { routeFor } from "./push-route";

// Server push for the app (docs/ANDROID_PLAN.md §7): the phone's Expo push
// token is registered with the server (POST /api/v1/push-devices →
// register_push_device), and push-dispatch sends the notifications rows to it
// through Expo → FCM. Each category lands in its own Android channel, so the
// person can silence one in the system settings; the app never asks for a
// sound or a vibration pattern. A tap opens the screen the notification is about.
//
// Permission is never asked at launch: the rest timer asks at the first rest,
// and the notifications screen offers it. Once granted, signing in registers
// the phone by itself.

/** Channel ids match push-dispatch's channelFor(). */
async function ensureChannels(t: Dictionary): Promise<void> {
  if (Platform.OS !== "android") return;
  const quiet = { sound: null, enableVibrate: false } as const;
  await Promise.all([
    Notifications.setNotificationChannelAsync("messages", { name: t.mobile.channels.messages, importance: Notifications.AndroidImportance.HIGH, ...quiet }),
    Notifications.setNotificationChannelAsync("coaching", { name: t.mobile.channels.coaching, importance: Notifications.AndroidImportance.HIGH, ...quiet }),
    Notifications.setNotificationChannelAsync("reminders", { name: t.mobile.channels.reminders, importance: Notifications.AndroidImportance.DEFAULT, ...quiet }),
    Notifications.setNotificationChannelAsync("updates", { name: t.mobile.channels.updates, importance: Notifications.AndroidImportance.LOW, ...quiet }),
  ]).catch(() => {});
}

export function PushProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { t } = useI18n();
  const signedIn = Boolean(session);

  useEffect(() => {
    // No push on the web build (the browser preview): the module throws there.
    if (!signedIn || Platform.OS === "web") return;
    void ensureChannels(t);
    // Already allowed (an earlier grant, or the rest timer's): register quietly.
    void enablePush(false);
    const tokenChange = Notifications.addPushTokenListener(() => void enablePush(false));
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      router.push(routeFor(response.notification.request.content.data as Record<string, unknown>));
    });
    // A tap that launched the app from closed.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) router.push(routeFor(response.notification.request.content.data as Record<string, unknown>));
    });
    return () => {
      tokenChange.remove();
      tapped.remove();
    };
  }, [signedIn, t]);

  return <>{children}</>;
}
