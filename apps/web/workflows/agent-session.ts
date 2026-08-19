import {
  cancelCodexTurnStep,
  checkTurnInterruptedStep,
  claimNextAgentTurnStep,
  failAgentSessionStep,
  finishCodexTurnStep,
  pollCodexTurnStep,
  prepareAgentTurnStep,
} from "./agent-session-steps";

/**
 * Errors thrown from a durable "use step" call are serialized for replay and
 * rehydrated as plain objects, not the original Error instance — so a bare
 * `instanceof Error` check here silently collapses every real failure reason
 * into a generic message. Fall back to the deserialized `.message` field.
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "Agent workflow failed.";
}

export async function agentSessionWorkflow(sessionId: string) {
  "use workflow";

  try {
    for (;;) {
      const turnId = await claimNextAgentTurnStep(sessionId);
      if (!turnId) return { sessionId, status: "idle" };
      const prepared = await prepareAgentTurnStep(turnId);
      if (prepared.kind === "codexPending") {
        await runCodexTurnToCompletion(prepared);
      }
    }
  } catch (error) {
    const message = extractErrorMessage(error);
    await failAgentSessionStep(sessionId, message);
    throw error;
  }
}

/**
 * `Buffer` isn't available inside a "use workflow" function (Node-specific
 * API) — decode through the standard `atob()` instead, which is.
 */
function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const combined = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }
  return combined;
}

/**
 * Polls a started Codex exec to completion, accumulating every chunk from
 * every poll — a single poll only carries output new since the caller's
 * last cursor, so it has to be concatenated across the whole run rather
 * than decoded chunk-by-chunk (a multi-byte UTF-8 character can straddle a
 * chunk boundary; only the full concatenated buffer is safe to decode).
 */
async function runCodexTurnToCompletion(prepared: {
  workspaceId: string;
  codexSessionId: string;
  turnId: string;
  credentialId: string;
}) {
  const { workspaceId, codexSessionId, turnId, credentialId } = prepared;
  let after = 0;
  const parts: Uint8Array[] = [];
  for (;;) {
    if (await checkTurnInterruptedStep(turnId)) {
      await cancelCodexTurnStep(workspaceId, codexSessionId, credentialId);
      return;
    }
    const poll = await pollCodexTurnStep(workspaceId, codexSessionId, after);
    after = poll.nextSequence;
    for (const chunk of poll.chunks) {
      parts.push(decodeBase64(chunk.dataBase64));
    }
    if (poll.exited) {
      await finishCodexTurnStep(turnId, credentialId, {
        output: new TextDecoder().decode(concatBytes(parts)),
        exitCode: poll.exitCode ?? 1,
        ...(poll.codexAuthCacheJson
          ? { codexAuthCacheJson: poll.codexAuthCacheJson }
          : {}),
      });
      return;
    }
  }
}
