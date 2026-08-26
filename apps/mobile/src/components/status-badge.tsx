import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Radii, StatusColors } from "@/constants/theme";
import type { AgentSessionStatus } from "@/lib/api-client";

const LABELS: Record<AgentSessionStatus, string> = {
  idle: "Idle",
  running: "Running",
  waiting: "Waiting for review",
  completed: "Completed",
  interrupted: "Interrupted",
  failed: "Failed",
};

export function StatusBadge({ status }: { status: AgentSessionStatus }) {
  const color = StatusColors[status];
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <ThemedText type="small" style={{ color }}>
        {LABELS[status]}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: Radii.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
