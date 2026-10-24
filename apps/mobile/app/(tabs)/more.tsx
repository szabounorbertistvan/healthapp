import Constants from "expo-constants";
import { router } from "expo-router";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Screen, T } from "@/components/ui";
import { signOut } from "@/lib/auth";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { isCoachRole, useMe } from "@/lib/role";
import { minTouchTarget, radius, space, useTheme } from "@/lib/theme";

export default function More() {
  const { t, fill, locale, setLocale } = useI18n();
  const { color } = useTheme();
  const me = useMe();
  const coach = isCoachRole(me.data?.data.role);
  const open = (path: string) => () => Linking.openURL(`${config.webUrl}${path}`);

  return (
    <Screen>
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body}>
          <T kind="title">{t.mobile.tabs.more}</T>
          {me.data ? <T kind="soft">{fill(t.mobile.more.signedInAs, { name: me.data.data.display_name })}</T> : null}

          {coach ? (
            <Card>
              <T kind="faint">{t.mobile.training.title}</T>
              <Link label={t.mobile.tabs.workout} onPress={() => router.push("/workout")} />
              <Link label={t.mobile.tabs.food} onPress={() => router.push("/food")} />
              <Link label={t.mobile.tabs.progress} onPress={() => router.push("/progress")} />
            </Card>
          ) : null}

          <Card>
            {coach ? null : <Link label={t.mobile.menu.coach} onPress={() => router.push("/messages")} />}
            <Link label={t.mobile.menu.notifications} onPress={() => router.push("/notifications")} />
            <Link label={t.mobile.menu.habits} onPress={() => router.push("/habits")} />
          </Card>

          <Card>
            <T kind="faint">{t.mobile.more.language}</T>
            <View style={styles.segment}>
              {(["ro", "en"] as const).map((l) => (
                <Pressable
                  key={l}
                  accessibilityRole="button"
                  accessibilityState={{ selected: locale === l }}
                  onPress={() => setLocale(l)}
                  style={[
                    styles.segmentItem,
                    { borderColor: color.line, backgroundColor: locale === l ? color.accent : "transparent" },
                  ]}
                >
                  <T style={{ color: locale === l ? color.accentFg : color.ink, fontWeight: "700" }}>{l.toUpperCase()}</T>
                </Pressable>
              ))}
            </View>
          </Card>

          <Card>
            <Link label={t.mobile.more.openWeb} onPress={open("/today")} />
            <Link label={t.mobile.more.privacy} onPress={open("/privacy")} />
            <Link label={t.mobile.more.deleteAccount} onPress={open("/delete-account")} />
          </Card>

          <Button kind="quiet" label={t.mobile.more.signOut} onPress={() => signOut().catch(() => {})} />
          <T kind="faint" style={{ textAlign: "center" }}>
            {fill(t.mobile.more.version, { version: Constants.expoConfig?.version ?? "?" })}
          </T>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} style={{ minHeight: minTouchTarget, justifyContent: "center" }}>
      <T kind="accent">{label}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  segment: { flexDirection: "row", gap: space.sm },
  segmentItem: {
    flex: 1,
    minHeight: minTouchTarget,
    borderWidth: 1,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
});
