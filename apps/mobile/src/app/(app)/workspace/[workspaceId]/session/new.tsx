import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Colors, Radii, Spacing } from "@/constants/theme";
import { createAgentSession } from "@/lib/api-client";

export default function NewSessionScreen() {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");

  const createMutation = useMutation({
    mutationFn: () => createAgentSession(workspaceId, { name, prompt }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: ["agent-sessions", workspaceId],
      });
      router.replace(`/workspace/${workspaceId}/session/${result.sessionId}`);
    },
  });

  const canSubmit = name.trim().length > 0 && prompt.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText themeColor="textSecondary" type="small">
            Name
          </ThemedText>
          <TextInput
            style={styles.input}
            placeholder="e.g. Fix login bug"
            placeholderTextColor={Colors.dark.textMuted}
            value={name}
            onChangeText={setName}
            maxLength={32}
          />

          <ThemedText
            themeColor="textSecondary"
            type="small"
            style={styles.label}
          >
            What should the agent do?
          </ThemedText>
          <TextInput
            style={[styles.input, styles.promptInput]}
            placeholder="Describe the task…"
            placeholderTextColor={Colors.dark.textMuted}
            value={prompt}
            onChangeText={setPrompt}
            multiline
            maxLength={20_000}
          />

          <Pressable
            style={[styles.button, !canSubmit && styles.buttonDisabled]}
            disabled={!canSubmit || createMutation.isPending}
            onPress={() => createMutation.mutate()}
          >
            {createMutation.isPending ? (
              <ActivityIndicator color={Colors.dark.background} />
            ) : (
              <ThemedText themeColor="background" type="smallBold">
                Start agent
              </ThemedText>
            )}
          </Pressable>

          {createMutation.isError ? (
            <ThemedText themeColor="danger" type="small" style={styles.error}>
              {createMutation.error instanceof Error
                ? createMutation.error.message
                : "Could not start the agent."}
            </ThemedText>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  content: { padding: Spacing.sm, gap: 6 },
  label: { marginTop: Spacing.sm },
  input: {
    color: Colors.dark.text,
    backgroundColor: Colors.dark.backgroundElement,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  promptInput: { minHeight: 140, textAlignVertical: "top" },
  button: {
    backgroundColor: Colors.dark.accent,
    borderRadius: Radii.full,
    paddingVertical: Spacing.xs,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    marginTop: Spacing.md,
    userSelect: "none",
  },
  buttonDisabled: { opacity: 0.4 },
  error: { textAlign: "center", marginTop: Spacing.xs },
});
