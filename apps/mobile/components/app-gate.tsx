import Constants from "expo-constants";
import { useEffect, useState, type ReactNode } from "react";
import { Linking, Platform, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Screen, T } from "@/components/ui";
import { fetchAppConfig } from "@/lib/api";
import { buildNumber, needsUpdate } from "@/lib/app-version";
import { useI18n } from "@/lib/i18n";
import { space } from "@/lib/theme";

/**
 * Asks the server once per launch whether this build is still supported
 * (GET /api/v1/app-config). Too old → an "Update" screen instead of the app;
 * no answer → the app, as usual (offline must never lock anyone out).
 */
export function AppGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [storeUrl, setStoreUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchAppConfig().then((config) => {
      if (!alive || !config) return;
      const build = buildNumber(Platform.OS, Constants.expoConfig);
      if (needsUpdate(config, Platform.OS, build)) setStoreUrl(Platform.OS === "ios" ? config.store_url.ios : config.store_url.android);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!storeUrl) return <>{children}</>;
  return (
    <Screen>
      <SafeAreaView style={styles.body}>
        <T kind="title">{t.mobile.update.title}</T>
        <T kind="soft">{t.mobile.update.body}</T>
        <Button label={t.mobile.update.button} onPress={() => void Linking.openURL(storeUrl)} />
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({ body: { flex: 1, padding: space.xl, gap: space.md, justifyContent: "center" } });
