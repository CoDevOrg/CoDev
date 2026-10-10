"use client";

import type { Gen2ChatMessage } from "@codev/contracts";

import { MemberAvatar } from "./member-avatar";
import { useWorkspaceRealtime } from "./use-workspace-realtime";

/**
 * Names the sender above another member's prompt, once per run of their
 * messages. Your own messages and those saved before authors were recorded
 * stay unlabelled: alignment already says whose they are.
 */
export function ChatMessageAuthor({
  message,
  previous,
}: {
  message: Gen2ChatMessage;
  previous: Gen2ChatMessage | undefined;
}) {
  const { currentUserId, members } = useWorkspaceRealtime();
  const author = message.authorUserId;
  if (!author || author === currentUserId) return null;
  if (previous?.role === "user" && previous.authorUserId === author)
    return null;
  const member = members.find((entry) => entry.userId === author);
  const name = member ? member.name || member.login : "Former member";
  return (
    <p className="gen2-chat-author">
      <MemberAvatar
        id={author}
        name={name}
        avatarUrl={member?.avatarUrl}
        className="gen2-chat-author-avatar"
      />
      <span>{name}</span>
    </p>
  );
}
