"use client";

import { useState } from "react";

import {
  MAX_GEN2_CHAT_ATTACHMENT_BYTES,
  MAX_GEN2_CHAT_ATTACHMENTS,
} from "@/lib/gen2/chat-attachments";

export type ChatAttachment = { id: string; file: File };

/** Files queued for the next turn, within the attachment limits. */
export function useChatAttachments(setError: (message: string) => void) {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

  function queueFiles(list: FileList | File[] | null) {
    const incoming = Array.from(list ?? []);
    if (incoming.length === 0) return;
    setError("");
    const room = MAX_GEN2_CHAT_ATTACHMENTS - attachments.length;
    const accepted = incoming.slice(0, Math.max(0, room)).filter((file) => {
      if (file.size <= MAX_GEN2_CHAT_ATTACHMENT_BYTES) return true;
      setError(`${file.name} is larger than 1 MB.`);
      return false;
    });
    if (incoming.length > room)
      setError(`You can attach up to ${MAX_GEN2_CHAT_ATTACHMENTS} files.`);
    if (accepted.length === 0) return;
    setAttachments((current) => [
      ...current,
      ...accepted.map((file) => ({ id: crypto.randomUUID(), file })),
    ]);
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }

  return { attachments, setAttachments, queueFiles, removeAttachment };
}
