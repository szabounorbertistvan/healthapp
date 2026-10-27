import { audienceOf } from "@healthapp/shared/onboarding";
import Constants from "expo-constants";
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePageTour } from "@/components/page-tour";
import { CoachProfileCard, DataCard, DeleteCard, EmailCard, GymCard, PrivacyCard, ProfileCard, RestCard } from "@/components/settings-forms";
import { Card, NavIcon, T } from "@/components/ui";
import { api } from "@/lib/api";
import { signOut } from "@/lib/auth";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { openLegal } from "@/lib/legal";
import { useOfflineQuery } from "@/lib/offline-query";
import { useMe } from "@/lib/role";
import { font, useTheme } from "@/lib/theme";

// Account — the web's /account on a phone (app/(client)/account/page.tsx; the
// coach's /settings carries the same cards): who is signed in, then one card
// per setting, in the web's order. Profile, gym, rest timer, email and privacy are edited
// right here (components/settings-forms.tsx, through the web's own actions);
// the data export and deletion too — all through the web's own actions.

const web = (path: string) => () => void Linking.openURL(`${config.webUrl}${path}`);

export default function Account() {
  const { t, fill, locale, setLocale } = useI18n();
  const { color } = useTheme();
  const me = useMe().data?.data;
  const settings = useOfflineQuery("settings", ["settings"], api.settings).data?.data;
  const a = t.clientApp.account;
  // the client's /account tour, or the coach's /settings one: this screen is both
  const coach = me ? audienceOf(me.role) === "coach" : false;
  const tour = usePageTour(coach ? "settings" : "account", coach ? ["coachProfile", "profile"] : ["profile", "gym", "email"], { ready: Boolean(me && settings) });

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
      <ScrollView ref={tour.scrollRef} onScroll={tour.onScroll} scrollEventThrottle={32} contentContainerStyle={styles.body}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <T kind="title" style={{ flex: 1 }}>{a.title}</T>
          {tour.button}
        </View>

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

        {settings ? <View ref={tour.target("profile")} collapsable={false}><ProfileCard key={`profile-${settings.account.username}`} settings={settings} /></View> : null}
        {settings ? <View ref={tour.target("coachProfile")} collapsable={false}><CoachProfileCard status={settings.coach_status ?? null} /></View> : null}
        {settings ? <View ref={tour.target("gym")} collapsable={false}><GymCard settings={settings} /></View> : null}
        {settings ? <RestCard settings={settings} /> : null}
        {settings ? <View ref={tour.target("email")} collapsable={false}><EmailCard settings={settings} /></View> : null}
        {settings ? <PrivacyCard settings={settings} /> : null}
        <DataCard />
        <DeleteCard />

        <Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
          <LinkRow label={t.mobile.more.openWeb} onPress={web("/today")} />
          <LinkRow label={t.mobile.more.privacy} onPress={() => openLegal("privacy", locale)} top />
          <LinkRow label={t.login.consentTermsLink} onPress={() => openLegal("terms", locale)} top />
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
      {tour.overlay}
    </SafeAreaView>
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
