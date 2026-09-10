import {
  prepareReplyStep,
  pollReplyStep,
  finishReplyStep,
  failReplyStep,
  cleanupReplyStep,
} from "./shared-chat-reply-steps";

export async function sharedChatReplyWorkflow(id: string) {
  "use workflow";
  let pending: { sessionId: string; credentialId: string } | null = null;
  try {
    pending = await prepareReplyStep(id);
    if (!pending) return;
    let after = 0;
    const parts: number[] = [];
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
        for (let i = 0; i < binary.length; i++)
          parts.push(binary.charCodeAt(i));
      }
      if (parts.length > 4_000_000)
        throw new Error("Reply output limit exceeded.");
      if (poll.exited) {
        await finishReplyStep(
          id,
          new TextDecoder().decode(new Uint8Array(parts)),
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
