import { Stack } from "expo-router";

import { Colors } from "@/constants/theme";

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.dark.background },
        headerTintColor: Colors.dark.text,
        headerShadowVisible: false,
        headerBackTitle: "Back",
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="workspace/new"
        options={{ title: "New Workspace", presentation: "modal" }}
      />
      <Stack.Screen
        name="workspace/[workspaceId]/index"
        options={{ title: "Workspace" }}
      />
      <Stack.Screen
        name="workspace/[workspaceId]/orca"
        options={{ title: "Terminal" }}
      />
      <Stack.Screen
        name="workspace/[workspaceId]/session/new"
        options={{ title: "New Session", presentation: "modal" }}
      />
      <Stack.Screen
        name="workspace/[workspaceId]/session/[sessionId]"
        options={{ title: "Session" }}
      />
    </Stack>
  );
}
