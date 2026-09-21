export type CodexExecChunk = {
  sequence: number;
  dataBase64: string;
};

function decodeBase64(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(value, "base64"));
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Guest chunks can split a UTF-8 character. Decode the whole ordered byte
 * stream once instead of each chunk on its own.
 */
export function decodeCodexExecOutput(chunks: CodexExecChunk[]): string {
  const ordered = [...chunks].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const total = ordered.reduce(
    (sum, chunk) => sum + decodeBase64(chunk.dataBase64).byteLength,
    0,
  );
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of ordered) {
    const piece = decodeBase64(chunk.dataBase64);
    bytes.set(piece, offset);
    offset += piece.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export function parseCodexExecOutput(output: string): {
  reply: string;
  failed: boolean;
} {
  let reply = "";
  let failed = false;
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const event = JSON.parse(trimmed) as {
        type?: unknown;
        item?: { type?: unknown; text?: unknown };
        error?: { message?: unknown };
      };
      if (
        event.type === "item.completed" &&
        event.item?.type === "agent_message" &&
        typeof event.item.text === "string" &&
        event.item.text.trim()
      ) {
        reply = event.item.text.trim();
      }
      if (event.type === "error") {
        failed = true;
        if (
          typeof event.error?.message === "string" &&
          event.error.message.trim()
        ) {
          reply = event.error.message.trim();
        }
      }
    } catch {
      /* PTY noise around JSON lines. */
    }
  }
  return { reply, failed };
}

export function mergeCodexExecChunks(
  existing: CodexExecChunk[],
  incoming: CodexExecChunk[],
): CodexExecChunk[] {
  const bySequence = new Map<number, CodexExecChunk>();
  for (const chunk of existing) bySequence.set(chunk.sequence, chunk);
  for (const chunk of incoming) bySequence.set(chunk.sequence, chunk);
  return [...bySequence.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
}
