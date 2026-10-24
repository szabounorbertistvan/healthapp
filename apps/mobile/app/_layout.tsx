import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AppGate } from "@/components/app-gate";
import { Button, Screen, T } from "@/components/ui";
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
  return (
    <SafeAreaProvider>
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
  const { dark, color } = useTheme();
  const signedIn = Boolean(session);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  useEffect(() => {
    if (ready && !signedIn) onSignOut();
  }, [ready, signedIn, onSignOut]);

  if (!ready) return null;
  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="workout/[dayId]/index" />
          <Stack.Screen name="workout/[dayId]/log" />
          <Stack.Screen name="food/add" />
          <Stack.Screen name="habits" />
          <Stack.Screen name="check-in" />
          <Stack.Screen name="messages" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="thread/[id]" />
          <Stack.Screen name="coach/check-in/[id]" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
      </Stack>
    </>
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
