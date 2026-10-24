import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Exo2_600SemiBold, Exo2_700Bold, Exo2_800ExtraBold } from "@expo-google-fonts/exo-2";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { useFonts } from "expo-font";
import { AppGate } from "@/components/app-gate";
import { Backdrop, Button, Screen, T } from "@/components/ui";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ApiFailure } from "@/lib/api";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { OutboxProvider } from "@/lib/outbox";
import { PushProvider } from "@/lib/push";
import { RestProvider } from "@/lib/rest";
import { wipeUserData } from "@/lib/storage";
import { useTheme } from "@/lib/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  // The web's type (Inter + Exo 2, app/layout.tsx). The splash stays up until they are in;
  // a font that fails to load falls back to the system one rather than a blank app.
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
    Exo2_600SemiBold, Exo2_700Bold, Exo2_800ExtraBold,
  });
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // A refused token will not be accepted on retry; a dropped signal might be.
            retry: (count, error) => !(error instanceof ApiFailure && error.kind === "unauthorized") && count < 2,
            staleTime: 30_000,
          },
        },
      }),
  );
  if (!fontsLoaded && !fontError) return null;
  return (
    <SafeAreaProvider>
      <Backdrop />
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <AuthProvider>
            <OutboxProvider>
              <RestProvider>
                <PushProvider>
                  <AppGate>
                    <Gate
                      onSignOut={() => {
                        queryClient.clear();
                        void wipeUserData();
                      }}
                    />
                  </AppGate>
                </PushProvider>
              </RestProvider>
            </OutboxProvider>
          </AuthProvider>
        </I18nProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/** Signed in → the tabs; signed out → sign-in. One person's data never outlives their session. */
function Gate({ onSignOut }: { onSignOut: () => void }) {
  const { ready, session } = useAuth();
  const { dark } = useTheme();
  const signedIn = Boolean(session);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  useEffect(() => {
    if (ready && !signedIn) onSignOut();
  }, [ready, signedIn, onSignOut]);

  if (!ready) return null;
  // The navigator paints its own background unless told otherwise; transparent
  // lets the Backdrop's ambient light (the web's body::before) show through.
  const base = dark ? DarkTheme : DefaultTheme;
  const navTheme = { ...base, colors: { ...base.colors, background: "transparent", card: "transparent" } };
  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "transparent" } }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="workout/[dayId]/index" />
          <Stack.Screen name="workout/[dayId]/log" />
          <Stack.Screen name="food/add" />
          <Stack.Screen name="check-in" />
          <Stack.Screen name="messages" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="thread/[id]" />
          <Stack.Screen name="coach/check-in/[id]" />
          <Stack.Screen name="leaderboards" />
          <Stack.Screen name="challenges" />
          <Stack.Screen name="achievements" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

/**
 * A screen that threw renders this instead of a blank app (expo-router's error
 * boundary). Nothing is lost: logged sets and meals wait in the phone's outbox.
 */
export function ErrorBoundary({ retry }: { error: Error; retry: () => Promise<void> }) {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <CrashScreen retry={retry} />
      </I18nProvider>
    </SafeAreaProvider>
  );
}

function CrashScreen({ retry }: { retry: () => Promise<void> }) {
  const { t } = useI18n();
  return (
    <Screen>
      <SafeAreaView style={{ flex: 1, padding: 24, gap: 12, justifyContent: "center" }}>
        <T kind="title">{t.mobile.crash.title}</T>
        <T kind="soft">{t.mobile.crash.body}</T>
        <Button label={t.mobile.crash.retry} onPress={() => void retry()} />
      </SafeAreaView>
    </Screen>
  );
}
