"use client";

import { useTypers } from "./use-chat-typing";
import { useWorkspaceRealtime } from "./use-workspace-realtime";

function sentence(names: string[]) {
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names[0]} and ${names.length - 1} others are typing…`;
}

/** "Alex is typing…" above the composer while another member writes here. */
export function ChatTypingIndicator({ chatId }: { chatId: string | null }) {
  const { members } = useWorkspaceRealtime();
  const names = useTypers(chatId).map((userId) => {
    const member = members.find((entry) => entry.userId === userId);
    return member ? member.name || member.login : "Someone";
  });
  return (
    <p className="gen2-chat-typing" aria-live="polite">
      {names.length ? sentence(names) : null}
    </p>
  );
}
