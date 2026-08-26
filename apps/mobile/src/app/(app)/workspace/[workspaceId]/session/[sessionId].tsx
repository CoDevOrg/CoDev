import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { StatusBadge } from "@/components/status-badge";
import { ThemedText } from "@/components/themed-text";
import { Colors, Radii, Spacing } from "@/constants/theme";
import {
  interruptAgentSession,
  listActivityEvents,
  listAgentSessions,
  sendAgentTurn,
  type ActivityEvent,
} from "@/lib/api-client";

function ActivityRow({ event }: { event: ActivityEvent }) {
  return (
    <View style={styles.eventRow}>
      <ThemedText type="small">{event.summary}</ThemedText>
      <ThemedText themeColor="textMuted" type="small">
        {event.actor} · {new Date(event.createdAt).toLocaleTimeString()}
      </ThemedText>
    </View>
  );
}

export default function SessionDetailScreen() {
  const { workspaceId, sessionId } = useLocalSearchParams<{
    workspaceId: string;
    sessionId: string;
  }>();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  const sessionsQuery = useQuery({
    queryKey: ["agent-sessions", workspaceId],
    queryFn: () => listAgentSessions(workspaceId),
  });
  const session = sessionsQuery.data?.sessions.find((s) => s.id === sessionId);

  const activityQuery = useQuery({
    queryKey: ["activity", workspaceId, sessionId],
    queryFn: () => listActivityEvents(workspaceId, sessionId),
    refetchInterval: session?.status === "running" ? 5_000 : 15_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["agent-sessions", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["activity", workspaceId, sessionId] });
    void queryClient.invalidateQueries({ queryKey: ["attention"] });
  };

  const replyMutation = useMutation({
    mutationFn: (prompt: string) => sendAgentTurn(workspaceId, sessionId, prompt),
    onSuccess: () => {
      setDraft("");
      invalidate();
    },
  });

  const interruptMutation = useMutation({
    mutationFn: () => interruptAgentSession(workspaceId, sessionId),
    onSuccess: invalidate,
  });

  const canReply = session?.status !== "failed";

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        {session ? (
          <View style={styles.header}>
            <StatusBadge status={session.status} />
            {(session.status === "running" || session.status === "waiting") && (
              <Pressable
                style={styles.interruptButton}
                onPress={() => interruptMutation.mutate()}
                disabled={interruptMutation.isPending}
              >
                <ThemedText themeColor="danger" type="small">
                  Interrupt
                </ThemedText>
              </Pressable>
            )}
          </View>
        ) : null}

        <FlatList
          data={activityQuery.data ?? []}
          keyExtractor={(event) => event.id}
          contentContainerStyle={styles.list}
          inverted
          renderItem={({ item }) => <ActivityRow event={item} />}
          ListEmptyComponent={
            !activityQuery.isLoading ? (
              <ThemedText themeColor="textSecondary" style={styles.empty}>
                No activity yet.
              </ThemedText>
            ) : null
          }
        />

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Reply to the agent…"
            placeholderTextColor={Colors.dark.textMuted}
            value={draft}
            onChangeText={setDraft}
            multiline
            editable={canReply}
          />
          <Pressable
            style={[styles.sendButton, (!draft.trim() || !canReply) && styles.sendButtonDisabled]}
            disabled={!draft.trim() || !canReply || replyMutation.isPending}
            onPress={() => replyMutation.mutate(draft.trim())}
          >
            <ThemedText themeColor="background" type="smallBold">
              Send
            </ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  interruptButton: {
    borderWidth: 1,
    borderColor: Colors.dark.danger,
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    userSelect: "none",
  },
  list: { padding: Spacing.sm, gap: Spacing.xs, flexGrow: 1 },
  eventRow: {
    gap: 2,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.dark.line,
  },
  empty: { textAlign: "center", marginTop: Spacing.lg, transform: [{ scaleY: -1 }] },
  composer: {
    flexDirection: "row",
    gap: Spacing.xs,
    padding: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.dark.line,
    alignItems: "flex-end",
  },
  input: {
    flex: 1,
    color: Colors.dark.text,
    backgroundColor: Colors.dark.backgroundElement,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    maxHeight: 120,
  },
  sendButton: {
    backgroundColor: Colors.dark.accent,
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.sm,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    userSelect: "none",
  },
  sendButtonDisabled: { opacity: 0.4 },
});
