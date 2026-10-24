import Constants from "expo-constants";
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EmailCard, ProfileCard, RestCard } from "@/components/settings-forms";
import { Card, NavIcon, T } from "@/components/ui";
import { api } from "@/lib/api";
import { signOut } from "@/lib/auth";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { isCoachRole, useMe } from "@/lib/role";
import { font, useTheme } from "@/lib/theme";

// Account — the web's /account on a phone (app/(client)/account/page.tsx; the
// coach's /settings carries the same cards): who is signed in, then one card
// per setting, in the web's order. Profile, rest timer and email are edited
// right here (components/settings-forms.tsx, through the web's own actions);
// the gym, social privacy, data export and deletion open on voinic.fit.

const web = (path: string) => () => void Linking.openURL(`${config.webUrl}${path}`);

export default function Account() {
  const { t, fill, locale, setLocale } = useI18n();
  const { color } = useTheme();
  const me = useMe().data?.data;
  const settings = useOfflineQuery("settings", ["settings"], api.settings).data?.data;
  const coach = isCoachRole(me?.role);
  const a = t.clientApp.account;
  const settingsPath = coach ? "/settings" : "/account";

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body}>
        <T kind="title">{a.title}</T>

        {me ? (
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            {me.avatar_url ? (
              <Image source={{ uri: me.avatar_url }} style={styles.avatar} accessibilityIgnoresInvertColors />
            ) : (
              <View style={[styles.avatar, { backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }]}>
                <Text style={{ fontFamily: font.displayExtrabold, fontSize: 20, color: color.accentInk }}>{me.display_name.charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{me.display_name}</Text>
              {me.username ? <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{`@${me.username}`}</Text> : null}
            </View>
          </Card>
        ) : null}

        <Card style={{ gap: 0 }}>
          <Text style={styles.label(color.inkFaint)}>{t.mobile.more.language}</Text>
          <View style={[styles.segment, { backgroundColor: color.bg }]}>
            {(["ro", "en"] as const).map((l) => {
              const on = locale === l;
              return (
                <Pressable
                  key={l}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  onPress={() => setLocale(l)}
                  style={[styles.segmentItem, on ? { backgroundColor: color.accent } : null]}
                >
                  <Text style={{ fontFamily: font.bold, fontSize: 13, color: on ? color.accentFg : color.inkSoft }}>{l.toUpperCase()}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        {settings ? <ProfileCard key={`profile-${settings.account.username}`} settings={settings} /> : null}
        <SettingRow title={t.gyms.my.title} hint={t.gyms.my.hint} onPress={web(settingsPath)} />
        {settings ? <RestCard settings={settings} /> : null}
        {settings ? <EmailCard settings={settings} /> : null}
        <SettingRow title={t.common.social.privacyTitle} hint={a.leaderboardsHint} onPress={web(settingsPath)} />
        <SettingRow title={a.yourData} hint={a.exportBody} onPress={web(settingsPath)} />
        <SettingRow title={a.deleteTitle} hint={a.deleteBody} danger onPress={web(settingsPath)} />

        <Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
          <LinkRow label={t.mobile.more.openWeb} onPress={web("/today")} />
          <LinkRow label={t.mobile.more.privacy} onPress={web("/privacy")} top />
        </Card>

        <Pressable
          accessibilityRole="button"
          onPress={() => signOut().catch(() => {})}
          style={({ pressed }) => [styles.signOut, { backgroundColor: color.surface, opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.inkSoft }}>{t.mobile.more.signOut}</Text>
        </Pressable>
        {me ? <Text style={styles.foot(color.inkFaint)}>{fill(t.mobile.more.signedInAs, { name: me.display_name })}</Text> : null}
        <Text style={styles.foot(color.inkFaint)}>{fill(t.mobile.more.version, { version: Constants.expoConfig?.version ?? "?" })}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/** One settings card: its title, what it holds, the chevron to the web form. */
function SettingRow({ title, hint, onPress, danger = false }: { title: string; hint?: string; onPress: () => void; danger?: boolean }) {
  const { color } = useTheme();
  return (
    <Pressable accessibilityRole="link" onPress={onPress}>
      {({ pressed }) => (
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 12, ...(pressed ? { opacity: 0.85 } : null) }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 16, color: danger ? color.risk : color.ink }}>{title}</Text>
            {hint ? <Text numberOfLines={2} style={{ marginTop: 4, fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: color.inkFaint }}>{hint}</Text> : null}
          </View>
          <NavIcon d="m9 6 6 6-6 6" size={16} color={color.inkFaint} />
        </Card>
      )}
    </Pressable>
  );
}

function LinkRow({ label, onPress, top = false }: { label: string; onPress: () => void; top?: boolean }) {
  const { color } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [styles.linkRow, top ? { borderTopWidth: 1, borderTopColor: color.line } : null, pressed ? { backgroundColor: color.bg } : null]}
    >
      <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 14, color: color.accentInk }}>{label}</Text>
      <NavIcon d="M7 17 17 7M8 7h9v9" size={15} color={color.inkFaint} />
    </Pressable>
  );
}

const styles = {
  ...StyleSheet.create({
    // 110 at the bottom: clear of the floating tab bar.
    body: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 110, gap: 14 },
    avatar: { width: 52, height: 52, borderRadius: 26 },
    segment: { marginTop: 10, flexDirection: "row", gap: 4, borderRadius: 16, padding: 4 },
    segmentItem: { flex: 1, alignItems: "center", borderRadius: 12, paddingVertical: 9 },
    linkRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 15 },
    signOut: { height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  }),
  label: (ink: string) => ({ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" as const, color: ink }),
  foot: (ink: string) => ({ textAlign: "center" as const, fontFamily: font.regular, fontSize: 12, color: ink }),
};
