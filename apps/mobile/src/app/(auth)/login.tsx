import * as WebBrowser from "expo-web-browser";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Colors, Radii, Spacing } from "@/constants/theme";
import {
  completeOAuthCallback,
  getOAuthStartUrl,
  OAUTH_CALLBACK_URL,
  signInWithCredentials,
  type OAuthProvider,
} from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const withOAuth = useCallback(
    async (provider: OAuthProvider) => {
      setError(null);
      setOauthLoading(provider);
      // A previous session left the native browser sheet in an "open" state
      // (e.g. the JS side reloaded mid-session via Fast Refresh/dev menu while
      // it was showing) — dismiss defensively before opening a new one, since
      // WebBrowser throws rather than reusing/replacing an existing session.
      await WebBrowser.dismissBrowser().catch(() => undefined);
      try {
        const result = await WebBrowser.openAuthSessionAsync(
          getOAuthStartUrl(provider),
          OAUTH_CALLBACK_URL,
        );
        if (result.type === "success") {
          await completeOAuthCallback(result.url);
          await signIn();
        }
      } catch (oauthError) {
        setError(
          oauthError instanceof Error
            ? oauthError.message
            : "Could not complete sign-in.",
        );
      } finally {
        setOauthLoading(null);
      }
    },
    [signIn],
  );

  const submitCredentials = useCallback(async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await signInWithCredentials({ intent: mode, email, password, name });
      await signIn();
    } catch (credentialsError) {
      setError(
        credentialsError instanceof Error
          ? credentialsError.message
          : "Could not sign in.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [email, mode, name, password, signIn]);

  const canSubmit =
    email.trim().length > 0 &&
    password.length > 0 &&
    (mode === "sign-in" || name.trim().length > 0);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <SafeAreaView style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <ThemedText type="title" style={styles.title}>
            CoDev
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.subtitle}>
            Monitor and steer your agents from your phone.
          </ThemedText>

          <Pressable
            style={[styles.oauthButton, styles.githubButton]}
            onPress={() => withOAuth("github")}
            disabled={oauthLoading !== null}
          >
            {oauthLoading === "github" ? (
              <ActivityIndicator color={Colors.dark.background} />
            ) : (
              <ThemedText themeColor="background" type="smallBold">
                Continue with GitHub
              </ThemedText>
            )}
          </Pressable>

          <Pressable
            style={[styles.oauthButton, styles.googleButton]}
            onPress={() => withOAuth("google")}
            disabled={oauthLoading !== null}
          >
            {oauthLoading === "google" ? (
              <ActivityIndicator color={Colors.dark.text} />
            ) : (
              <ThemedText type="smallBold">Continue with Google</ThemedText>
            )}
          </Pressable>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <ThemedText themeColor="textMuted" type="small">
              or
            </ThemedText>
            <View style={styles.dividerLine} />
          </View>

          {mode === "sign-up" ? (
            <TextInput
              style={styles.input}
              placeholder="Name"
              placeholderTextColor={Colors.dark.textMuted}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
          ) : null}
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={Colors.dark.textMuted}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={Colors.dark.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
          />

          <Pressable
            style={[styles.primaryButton, !canSubmit && styles.buttonDisabled]}
            onPress={submitCredentials}
            disabled={!canSubmit || isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color={Colors.dark.background} />
            ) : (
              <ThemedText themeColor="background" type="smallBold">
                {mode === "sign-in" ? "Sign in" : "Create account"}
              </ThemedText>
            )}
          </Pressable>

          <Pressable
            onPress={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
          >
            <ThemedText themeColor="textSecondary" style={styles.toggleText}>
              {mode === "sign-in"
                ? "Don't have an account? Create one"
                : "Already have an account? Sign in"}
            </ThemedText>
          </Pressable>

          {error ? (
            <ThemedText themeColor="danger" style={styles.error}>
              {error}
            </ThemedText>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.lg,
    gap: Spacing.xs,
  },
  title: { textAlign: "center" },
  subtitle: { textAlign: "center", marginBottom: Spacing.md },
  oauthButton: {
    borderRadius: Radii.full,
    paddingVertical: Spacing.xs,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    userSelect: "none",
  },
  githubButton: { backgroundColor: Colors.dark.text },
  googleButton: {
    backgroundColor: Colors.dark.backgroundElement,
    borderWidth: 1,
    borderColor: Colors.dark.line,
    marginTop: Spacing.xs,
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginVertical: Spacing.sm,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.dark.line },
  input: {
    color: Colors.dark.text,
    backgroundColor: Colors.dark.backgroundElement,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  primaryButton: {
    backgroundColor: Colors.dark.accent,
    borderRadius: Radii.full,
    paddingVertical: Spacing.xs,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    marginTop: Spacing.xs,
    userSelect: "none",
  },
  buttonDisabled: { opacity: 0.4 },
  toggleText: { textAlign: "center", marginTop: Spacing.sm },
  error: { textAlign: "center", marginTop: Spacing.sm },
});
