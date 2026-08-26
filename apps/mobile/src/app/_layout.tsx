import { QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, Stack, ThemeProvider, useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";

import { AuthProvider, useAuth } from "@/lib/auth-context";
import { extractDeepLinkData } from "@/lib/notifications";
import { queryClient } from "@/lib/query-client";

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { isLoading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) SplashScreen.hideAsync();
  }, [isLoading]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const { workspaceId, sessionId } = extractDeepLinkData(response);
        if (workspaceId && sessionId) {
          router.push(`/workspace/${workspaceId}/session/${sessionId}`);
        } else if (workspaceId) {
          router.push(`/workspace/${workspaceId}`);
        }
      },
    );
    return () => subscription.remove();
  }, [router]);

  if (isLoading) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="(auth)/login" />
      </Stack.Protected>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider value={DarkTheme}>
          <RootNavigator />
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
