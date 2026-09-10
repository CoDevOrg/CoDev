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
  return pollRoomReply(id, sessionId, credentialId, after);
}

export async function finishReplyStep(
  id: string,
  output: string,
  exitCode: number,
) {
  "use step";
  const { finishCodexRoomReply } = await import("@/lib/shared-chat-reply");
  await finishCodexRoomReply(id, output, exitCode);
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
