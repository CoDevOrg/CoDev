import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card } from "@/components/card";
import { ThemedText } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";
import { listWorkspaces, type WorkspaceSummary } from "@/lib/api-client";

function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function WorkspaceCard({ workspace }: { workspace: WorkspaceSummary }) {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push(`/workspace/${workspace.id}`)}>
      <Card style={styles.card}>
        <ThemedText type="smallBold">
          {workspace.repository || "Blank workspace"}
        </ThemedText>
        <View style={styles.metaRow}>
          {workspace.defaultBranch ? (
            <>
              <ThemedText themeColor="textSecondary" type="small">
                {workspace.defaultBranch}
              </ThemedText>
              <ThemedText themeColor="textMuted" type="small">
                ·
              </ThemedText>
            </>
          ) : null}
          <ThemedText themeColor="textSecondary" type="small">
            {workspace.status}
          </ThemedText>
          <ThemedText themeColor="textMuted" type="small">
            ·
          </ThemedText>
          <ThemedText themeColor="textSecondary" type="small">
            {relativeTime(workspace.updatedAt)}
          </ThemedText>
        </View>
      </Card>
    </Pressable>
  );
}

export default function WorkspacesScreen() {
  const query = useQuery({ queryKey: ["workspaces"], queryFn: listWorkspaces });

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <FlatList
        data={query.data?.workspaces ?? []}
        keyExtractor={(workspace) => workspace.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => query.refetch()}
            tintColor={Colors.dark.textSecondary}
          />
        }
        renderItem={({ item }) => <WorkspaceCard workspace={item} />}
        ListEmptyComponent={
          !query.isLoading ? (
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              No workspaces yet.
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
  metaRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  empty: { textAlign: "center", marginTop: Spacing.lg },
});
