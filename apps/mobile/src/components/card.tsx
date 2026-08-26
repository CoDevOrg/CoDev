import { BlurView } from "expo-blur";
import type { PropsWithChildren } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";

import { Colors, Radii } from "@/constants/theme";

/**
 * A translucent "glass" card, per the apple-design skill's glassmorphism
 * pattern: a BlurView layered over a tinted forest-900 background (RN's
 * blur doesn't composite background-color the way CSS backdrop-filter
 * does, so the tint is applied separately underneath it).
 */
export function Card({
  children,
  style,
}: PropsWithChildren<{ style?: ViewStyle }>) {
  return (
    <View style={[styles.wrapper, style]}>
      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: Radii.xl,
    overflow: "hidden",
    backgroundColor: "rgba(20,44,34,0.7)",
    borderWidth: 1,
    borderColor: Colors.dark.line,
  },
  content: {
    padding: 16,
  },
});
