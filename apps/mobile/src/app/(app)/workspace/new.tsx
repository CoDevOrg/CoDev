import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card } from "@/components/card";
import { ThemedText } from "@/components/themed-text";
import { Colors, Radii, Spacing } from "@/constants/theme";
import {
  createWorkspace,
  listGitHubInstallations,
  listInstallationRepositories,
  type GitHubInstallation,
  type GitHubRepository,
} from "@/lib/api-client";

export default function NewWorkspaceScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [installation, setInstallation] = useState<GitHubInstallation | null>(
    null,
  );

  const installationsQuery = useQuery({
    queryKey: ["github-installations"],
    queryFn: listGitHubInstallations,
  });
  const installations = installationsQuery.data?.installations ?? [];

  const activeInstallation =
    installation ?? (installations.length === 1 ? installations[0] : null);

  const repositoriesQuery = useQuery({
    queryKey: ["github-repositories", activeInstallation?.id],
    queryFn: () => listInstallationRepositories(activeInstallation!.id),
    enabled: !!activeInstallation,
  });

  const createMutation = useMutation({
    mutationFn: (repository?: GitHubRepository) =>
      repository
        ? createWorkspace({
            installationId: activeInstallation!.id,
            repositoryId: repository.id,
          })
        : createWorkspace(),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      router.replace(`/workspace/${result.workspace.id}`);
    },
  });

  const blankWorkspaceButton = (
    <Pressable
      style={styles.blankButton}
      onPress={() => createMutation.mutate(undefined)}
      disabled={createMutation.isPending}
    >
      <ThemedText themeColor="accentBright" type="smallBold">
        Create blank workspace (no repo)
      </ThemedText>
    </Pressable>
  );

  const footer = (
    <>
      {createMutation.isPending ? (
        <View style={styles.overlay}>
          <ActivityIndicator color={Colors.dark.accentBright} />
          <ThemedText themeColor="textSecondary" type="small">
            Creating workspace…
          </ThemedText>
        </View>
      ) : null}
      {createMutation.isError ? (
        <ThemedText themeColor="danger" type="small" style={styles.error}>
          {createMutation.error instanceof Error
            ? createMutation.error.message
            : "Could not create the workspace."}
        </ThemedText>
      ) : null}
    </>
  );

  if (installationsQuery.isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={Colors.dark.textSecondary} style={styles.spinner} />
      </SafeAreaView>
    );
  }

  if (installationsQuery.isError || installations.length === 0) {
    const message =
      installationsQuery.error instanceof Error
        ? installationsQuery.error.message
        : null;
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.emptyState}>
          <ThemedText type="smallBold">No GitHub access yet</ThemedText>
          <ThemedText themeColor="textSecondary" type="small" style={styles.emptyBody}>
            {message ??
              "Connect a GitHub account or install the CoDev GitHub App from the web dashboard to pick a repository."}
          </ThemedText>
          {blankWorkspaceButton}
        </View>
        {footer}
      </SafeAreaView>
    );
  }

  if (!activeInstallation) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <FlatList
          data={installations}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ListHeaderComponent={blankWorkspaceButton}
          renderItem={({ item }) => (
            <Pressable onPress={() => setInstallation(item)}>
              <Card style={styles.card}>
                <ThemedText type="smallBold">{item.account.login}</ThemedText>
                <ThemedText themeColor="textSecondary" type="small">
                  {item.account.type}
                </ThemedText>
              </Card>
            </Pressable>
          )}
        />
        {footer}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <FlatList
        data={repositoriesQuery.data?.repositories ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        ListHeaderComponent={blankWorkspaceButton}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => createMutation.mutate(item)}
            disabled={createMutation.isPending}
          >
            <Card style={styles.card}>
              <ThemedText type="smallBold">{item.full_name}</ThemedText>
              <ThemedText themeColor="textSecondary" type="small">
                {item.default_branch}
                {item.private ? " · private" : ""}
              </ThemedText>
            </Card>
          </Pressable>
        )}
        ListEmptyComponent={
          repositoriesQuery.isLoading ? (
            <ActivityIndicator color={Colors.dark.textSecondary} style={styles.spinner} />
          ) : (
            <ThemedText themeColor="textSecondary" style={styles.emptyBody}>
              No repositories available for this account.
            </ThemedText>
          )
        }
      />
      {footer}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  list: { padding: Spacing.sm, gap: Spacing.xs },
  card: { gap: 6 },
  spinner: { marginTop: Spacing.lg },
  emptyState: { padding: Spacing.sm, gap: Spacing.sm, marginTop: Spacing.lg },
  emptyBody: { textAlign: "center" },
  blankButton: {
    borderWidth: 1,
    borderColor: Colors.dark.lineStrong,
    borderRadius: Radii.lg,
    padding: Spacing.sm,
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  overlay: {
    position: "absolute",
    bottom: Spacing.md,
    left: Spacing.sm,
    right: Spacing.sm,
    backgroundColor: Colors.dark.backgroundElement,
    borderRadius: Radii.lg,
    padding: Spacing.sm,
    alignItems: "center",
    gap: 6,
  },
  error: { textAlign: "center", padding: Spacing.sm },
});
