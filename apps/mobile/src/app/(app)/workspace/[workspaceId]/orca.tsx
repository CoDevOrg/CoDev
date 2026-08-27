import { randomUUID } from "expo-crypto";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Colors, Radii, Spacing } from "@/constants/theme";
import { connectOrcaWorkspace, OrcaSessionError } from "@/lib/orca-session";
import {
  ensureOrcaTerminal,
  sendOrcaTerminalInput,
  subscribeOrcaTerminal,
} from "@/lib/orca-terminal";
import { TerminalWebView } from "@/vendor/orca/mobile/src/terminal/TerminalWebView";
import type { TerminalWebViewHandle } from "@/vendor/orca/mobile/src/terminal/terminal-webview-contract";
import type { RpcClient } from "@/vendor/orca/mobile/src/transport/rpc-client";

const VIEWPORT = { cols: 100, rows: 32 };

type ScreenState =
  | { phase: "connecting" }
  | { phase: "host-starting" }
  | { phase: "streaming" }
  | { phase: "error"; message: string };

export default function OrcaTerminalScreen() {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>();
  const [state, setState] = useState<ScreenState>({ phase: "connecting" });
  const [input, setInput] = useState("");
  const terminalRef = useRef<TerminalWebViewHandle>(null);
  const clientId = useMemo(() => randomUUID(), []);
  const rpcClientRef = useRef<RpcClient | null>(null);
  const terminalHandleRef = useRef<string | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function start() {
      try {
        const result = await connectOrcaWorkspace(workspaceId);
        if (cancelled) return;
        if (result.state === "host-starting") {
          setState({ phase: "host-starting" });
          retryTimer = setTimeout(start, 3000);
          return;
        }
        rpcClientRef.current = result.client;
        const handle = await ensureOrcaTerminal(result.client);
        if (cancelled) return;
        terminalHandleRef.current = handle;
        unsubscribe = subscribeOrcaTerminal(
          result.client,
          handle,
          clientId,
          VIEWPORT,
          (event) => {
            if (event.type === "scrollback" || event.type === "resized") {
              if (!initializedRef.current) {
                initializedRef.current = true;
                terminalRef.current?.init(
                  VIEWPORT.cols,
                  VIEWPORT.rows,
                  event.serialized,
                );
                setState({ phase: "streaming" });
              } else {
                terminalRef.current?.write(event.serialized);
              }
            } else if (event.type === "data") {
              if (!initializedRef.current) {
                initializedRef.current = true;
                terminalRef.current?.init(
                  VIEWPORT.cols,
                  VIEWPORT.rows,
                  event.chunk,
                );
                setState({ phase: "streaming" });
              } else {
                terminalRef.current?.write(event.chunk);
              }
            } else if (event.type === "subscribed" && event.streamId === null) {
              initializedRef.current = true;
              terminalRef.current?.init(
                VIEWPORT.cols,
                VIEWPORT.rows,
                (event.lines ?? []).join("\n"),
              );
              setState({ phase: "streaming" });
            } else if (event.type === "error") {
              setState({ phase: "error", message: event.message });
            }
          },
        );
      } catch (error) {
        if (cancelled) return;
        setState({
          phase: "error",
          message:
            error instanceof OrcaSessionError || error instanceof Error
              ? error.message
              : "Could not open this workspace's terminal.",
        });
      }
    }

    start();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribe?.();
      rpcClientRef.current?.close();
    };
  }, [workspaceId, clientId]);

  function handleSend() {
    const client = rpcClientRef.current;
    const handle = terminalHandleRef.current;
    if (!client || !handle || !input.trim()) return;
    const text = input;
    setInput("");
    void sendOrcaTerminalInput(client, handle, clientId, text, true);
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <Stack.Screen options={{ title: "Terminal" }} />
      {state.phase !== "streaming" ? (
        <View style={styles.centerFill}>
          {state.phase === "error" ? (
            <ThemedText themeColor="danger" style={styles.centerText}>
              {state.message}
            </ThemedText>
          ) : (
            <>
              <ActivityIndicator color={Colors.dark.textSecondary} />
              <ThemedText themeColor="textSecondary" style={styles.centerText}>
                {state.phase === "host-starting"
                  ? "Waking up your workspace…"
                  : "Connecting…"}
              </ThemedText>
            </>
          )}
        </View>
      ) : null}
      <View
        style={[
          styles.terminalContainer,
          state.phase !== "streaming" && styles.hidden,
        ]}
      >
        <TerminalWebView ref={terminalRef} style={styles.terminal} />
      </View>
      {state.phase === "streaming" ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={8}
        >
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Send to terminal…"
              placeholderTextColor={Colors.dark.textMuted}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={handleSend}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable style={styles.sendButton} onPress={handleSend}>
              <ThemedText themeColor="background" type="smallBold">
                Send
              </ThemedText>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  centerFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
  },
  centerText: { textAlign: "center", paddingHorizontal: Spacing.lg },
  terminalContainer: { flex: 1 },
  hidden: { flex: 0, height: 0, overflow: "hidden" },
  terminal: { flex: 1 },
  inputRow: {
    flexDirection: "row",
    gap: Spacing.xs,
    padding: Spacing.sm,
    alignItems: "center",
  },
  input: {
    flex: 1,
    color: Colors.dark.text,
    backgroundColor: Colors.dark.backgroundElement,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  sendButton: {
    backgroundColor: Colors.dark.accent,
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
