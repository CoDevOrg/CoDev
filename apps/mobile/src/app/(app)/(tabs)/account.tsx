import { Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Colors, Radii, Spacing } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";

export default function AccountScreen() {
  const { signOut } = useAuth();

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.content}>
        <ThemedText type="subtitle">Account</ThemedText>
        <Pressable style={styles.signOutButton} onPress={signOut}>
          <ThemedText themeColor="danger" type="smallBold">
            Sign out
          </ThemedText>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  content: { padding: Spacing.sm, gap: Spacing.md },
  signOutButton: {
    borderWidth: 1,
    borderColor: Colors.dark.danger,
    borderRadius: Radii.full,
    paddingVertical: Spacing.xs,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
    userSelect: "none",
  },
});
