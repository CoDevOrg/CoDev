import {
  PARTIAL_PUBLISH_MIN_GROWTH,
  decodeReplyBytes,
  extractPartialReplyText,
} from "@/lib/chat/room-reply-stream";

import {
  prepareReplyStep,
  pollReplyStep,
  finishReplyStep,
  failReplyStep,
  cleanupReplyStep,
  publishPartialReplyStep,
} from "./shared-chat-reply-steps";

export async function sharedChatReplyWorkflow(id: string) {
  "use workflow";
  let pending: {
    sessionId: string;
    credentialId: string;
    provider: "claude" | "codex";
  } | null = null;
  try {
    pending = await prepareReplyStep(id);
    if (!pending) return;
    let after = 0;
    // Keep the raw bytes as latin1 strings rather than a number[]: this array
    // is serialized into durable workflow state between every poll step, and a
    // boxed number per byte made a multi-megabyte turn expensive to persist.
    const parts: string[] = [];
    let size = 0;
    let publishedLength = 0;
    const deadline = Date.now() + 8 * 60_000;
    while (Date.now() < deadline) {
      const poll = await pollReplyStep(
        id,
        pending.sessionId,
        pending.credentialId,
        after,
      );
      after = poll.nextSequence;
      for (const chunk of poll.chunks) {
        const binary = atob(chunk.dataBase64);
        size += binary.length;
        parts.push(binary);
      }
      if (size > 4_000_000) throw new Error("Reply output limit exceeded.");
      if (!poll.exited && poll.chunks.length) {
        // Show the room what the turn has written so far. Throttled by growth
        // so a fast-writing CLI cannot turn every chunk into a durable step,
        // and best-effort: the committed reply comes from the full output.
        const partial = extractPartialReplyText(
          decodeReplyBytes(parts.join("")),
          pending.provider,
        );
        if (partial.length - publishedLength >= PARTIAL_PUBLISH_MIN_GROWTH) {
          publishedLength = partial.length;
          await publishPartialReplyStep(id, partial);
        }
      }
      if (poll.exited) {
        await finishReplyStep(
          id,
          decodeReplyBytes(parts.join("")),
          poll.exitCode ?? 1,
        );
        return;
      }
    }
    throw new Error("Reply timed out.");
  } catch {
    await failReplyStep(id);
  } finally {
    if (pending)
      await cleanupReplyStep(id, pending.credentialId, pending.sessionId);
  }
}
