import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card } from "@/components/card";
import { StatusBadge } from "@/components/status-badge";
import { ThemedText } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";
import { listAgentSessions, type AgentSessionSummary } from "@/lib/api-client";

function SessionCard({
  workspaceId,
  session,
}: {
  workspaceId: string;
  session: AgentSessionSummary;
}) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() =>
        router.push(`/workspace/${workspaceId}/session/${session.id}`)
      }
    >
      <Card style={styles.card}>
        <ThemedText type="smallBold">{session.name}</ThemedText>
        <ThemedText themeColor="textSecondary" type="small">
          {session.provider} · {session.model}
        </ThemedText>
        <StatusBadge status={session.status} />
      </Card>
    </Pressable>
  );
}

export default function WorkspaceDetailScreen() {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>();
  const router = useRouter();
  const query = useQuery({
    queryKey: ["agent-sessions", workspaceId],
    queryFn: () => listAgentSessions(workspaceId),
  });

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerButtons}>
              <Pressable
                onPress={() => router.push(`/workspace/${workspaceId}/orca`)}
                style={styles.headerButton}
              >
                <Ionicons
                  name="terminal-outline"
                  color={Colors.dark.accentBright}
                  size={22}
                />
              </Pressable>
              <Pressable
                onPress={() =>
                  router.push(`/workspace/${workspaceId}/session/new`)
                }
                style={styles.headerButton}
              >
                <Ionicons
                  name="add"
                  color={Colors.dark.accentBright}
                  size={26}
                />
              </Pressable>
            </View>
          ),
        }}
      />
      <FlatList
        data={query.data?.sessions ?? []}
        keyExtractor={(session) => session.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => query.refetch()}
            tintColor={Colors.dark.textSecondary}
          />
        }
        renderItem={({ item }) => (
          <SessionCard workspaceId={workspaceId} session={item} />
        )}
        ListEmptyComponent={
          !query.isLoading ? (
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              No agent sessions in this workspace yet.
            </ThemedText>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerButtons: { flexDirection: "row" },
  headerButton: { paddingHorizontal: Spacing.xs },
  container: { flex: 1, backgroundColor: Colors.dark.background },
  list: { padding: Spacing.sm, gap: Spacing.xs },
  card: { gap: 6 },
  empty: { textAlign: "center", marginTop: Spacing.lg },
});
