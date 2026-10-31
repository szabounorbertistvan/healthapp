import { router, Stack } from "expo-router";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Logo, Screen, T } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

// A link that leads nowhere in the app (an old or mistyped voinic://…) lands
// here instead of expo-router's developer list of every route. The web's
// renamed addresses (voinic://today) are rewritten before this (+native-intent.tsx).
export default function NotFound() {
  const { t } = useI18n();
  const m = t.mobile.notFound;
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={{ flex: 1, padding: 24, gap: 12, justifyContent: "center" }}>
        <View style={{ alignItems: "flex-start", marginBottom: 12 }}><Logo height={22} /></View>
        <T kind="title">{m.title}</T>
        <T kind="soft">{m.body}</T>
        <View style={{ alignSelf: "flex-start", marginTop: 8 }}>
          {/* signed out, "/" is guarded and expo-router sends the person to sign-in instead */}
          <Button label={m.home} onPress={() => router.replace("/")} />
        </View>
      </SafeAreaView>
    </Screen>
  );
}
