import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Tabs, useRouter } from "expo-router";
import { Pressable } from "react-native";

import { Colors, Spacing } from "@/constants/theme";
import { listAttentionItems } from "@/lib/api-client";

export default function TabsLayout() {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["attention"],
    queryFn: listAttentionItems,
    refetchInterval: 30_000,
  });
  const badgeCount = data?.items.length ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: Colors.dark.background },
        headerTintColor: Colors.dark.text,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: Colors.dark.backgroundElement },
        tabBarActiveTintColor: Colors.dark.accentBright,
        tabBarInactiveTintColor: Colors.dark.textSecondary,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Workspaces",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="folder-outline" color={color} size={size} />
          ),
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/workspace/new")}
              style={{ paddingHorizontal: Spacing.xs }}
            >
              <Ionicons name="add" color={Colors.dark.accentBright} size={26} />
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Attention",
          ...(badgeCount > 0 ? { tabBarBadge: badgeCount } : {}),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
