import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { FlatList, Pressable, RefreshControl, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card } from "@/components/card";
import { StatusBadge } from "@/components/status-badge";
import { ThemedText } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";
import { listAttentionItems, type AttentionItem } from "@/lib/api-client";

function AttentionCard({ item }: { item: AttentionItem }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() =>
        router.push(`/workspace/${item.workspaceId}/session/${item.sessionId}`)
      }
    >
      <Card style={styles.card}>
        <ThemedText type="smallBold">{item.sessionName}</ThemedText>
        <ThemedText themeColor="textSecondary" type="small">
          {item.repository ?? "Unknown repository"}
        </ThemedText>
        <StatusBadge status={item.status} />
        {item.lastError ? (
          <ThemedText themeColor="danger" type="small" numberOfLines={2}>
            {item.lastError}
          </ThemedText>
        ) : null}
      </Card>
    </Pressable>
  );
}

export default function AttentionScreen() {
  const query = useQuery({
    queryKey: ["attention"],
    queryFn: listAttentionItems,
    refetchInterval: 30_000,
  });

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <FlatList
        data={query.data?.items ?? []}
        keyExtractor={(item) => item.sessionId}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => query.refetch()}
            tintColor={Colors.dark.textSecondary}
          />
        }
        renderItem={({ item }) => <AttentionCard item={item} />}
        ListEmptyComponent={
          !query.isLoading ? (
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              Nothing needs your attention right now.
            </ThemedText>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  list: { padding: Spacing.sm, gap: Spacing.xs },
  card: { gap: 6 },
  empty: { textAlign: "center", marginTop: Spacing.lg },
});
