import { Linking, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Screen, T } from "@/components/ui";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { space } from "@/lib/theme";

/**
 * A tab whose native screen is not built yet (docs/ANDROID_PLAN.md §9 says
 * which phase brings it): it says so and opens the same screen on the web,
 * where the person's account already works.
 */
export function OnWeb({ title, path }: { title: string; path: string }) {
  const { t } = useI18n();
  return (
    <Screen>
      <SafeAreaView edges={["top"]} style={styles.body}>
        <T kind="title">{title}</T>
        <Card>
          <T kind="heading">{t.mobile.soon.title}</T>
          <T kind="soft">{t.mobile.soon.body}</T>
          <Button label={t.mobile.soon.open} onPress={() => Linking.openURL(`${config.webUrl}${path}`)} />
        </Card>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({ body: { flex: 1, padding: space.lg, gap: space.md } });
