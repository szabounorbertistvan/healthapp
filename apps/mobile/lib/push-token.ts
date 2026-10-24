import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "./secure-store";
import { Platform } from "react-native";
import { api } from "./api";

// Registering this phone's Expo push token with the server, and removing it on
// sign-out — kept apart from lib/push.tsx so lib/auth.tsx can call disablePush()
// without the two importing each other.

const TOKEN_KEY = "voinic-push-token";

export type PushState = "granted" | "denied" | "unavailable";

/**
 * Register this phone for push. `ask` shows the system prompt when Android
 * still allows it. "unavailable" means the build carries no EAS project id
 * (a development build without `eas init`) or no network: nothing to register.
 */
export async function enablePush(ask: boolean): Promise<PushState> {
  try {
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && ask && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return "denied";
    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return "unavailable";
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await api.registerPush({
      token,
      platform: Platform.OS === "ios" ? "ios" : "android",
      build: String(Constants.expoConfig?.android?.versionCode ?? Constants.expoConfig?.version ?? ""),
    });
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    return "granted";
  } catch {
    return "unavailable";
  }
}

/** Before signing out: this phone stops receiving the person's pushes. */
export async function disablePush(): Promise<void> {
  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (token) await api.unregisterPush(token);
  } catch {
    // Offline: the server forgets the token when the next person signs in on
    // this phone (the token moves), or when Expo reports it dead.
  } finally {
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  }
}

