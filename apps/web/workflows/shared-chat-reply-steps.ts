export async function prepareReplyStep(id: string) {
  "use step";
  const { prepareRoomReply, failRoomReply } =
    await import("@/lib/shared-chat-reply");
  try {
    return await prepareRoomReply(id);
  } catch (error) {
    // Persist the curated failure here; raw SDK errors can contain credentials
    // and must never enter the durable workflow's serialized history.
    await failRoomReply(id, error);
    return null;
  }
}
prepareReplyStep.maxRetries = 0;

export async function pollReplyStep(
  id: string,
  sessionId: string,
  credentialId: string,
  after: number,
) {
  "use step";
  const { pollRoomReply } = await import("@/lib/shared-chat-reply");
  try {
    return await pollRoomReply(id, sessionId, credentialId, after);
  } catch (error) {
    // The workflow's catch turns any failure here into the generic member
    // message; record the real (redacted) cause for operators before rethrowing.
    await logReplyStepError(id, "poll", error);
    throw error;
  }
}

export async function finishReplyStep(
  id: string,
  output: string,
  exitCode: number,
) {
  "use step";
  const { finishCodexRoomReply } = await import("@/lib/shared-chat-reply");
  try {
    await finishCodexRoomReply(id, output, exitCode);
  } catch (error) {
    await logReplyStepError(id, "finish", error, { exitCode });
    throw error;
  }
}

/** Emit the real (redacted) cause of a reply-stage failure for operators. */
async function logReplyStepError(
  id: string,
  stage: "poll" | "finish",
  error: unknown,
  extra: Record<string, number | string> = {},
) {
  const { logEvent } = await import("@/lib/observability");
  logEvent("error", "room_reply_step_failed", {
    replyId: id,
    stage,
    detail: error instanceof Error ? error.message : String(error),
    ...extra,
  });
}

export async function failReplyStep(id: string) {
  "use step";
  const { finishRoomReply, ROOM_REPLY_FAILURE } =
    await import("@/lib/shared-chat-reply");
  await finishRoomReply(id, ROOM_REPLY_FAILURE, true);
}

export async function cleanupReplyStep(
  id: string,
  credentialId: string,
  sessionId: string,
) {
  "use step";
  const { cleanupRoomReply } = await import("@/lib/shared-chat-reply");
  await cleanupRoomReply(id, credentialId, sessionId);
}
