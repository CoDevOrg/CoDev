"use client";

import { useWorkspaceRealtime } from "./use-workspace-realtime";

/** Names whose turn a live bubble is when another member started it. */
export function LiveTurnOwner({ userId }: { userId: string }) {
  const { members } = useWorkspaceRealtime();
  const member = members.find((entry) => entry.userId === userId);
  const name = member ? member.name || member.login : "Another member";
  return <p className="gen2-chat-live-owner">{name}’s turn</p>;
}
