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

/**
 * Decodes one poll's worth of chunks for a stream the server accumulates
 * across many polls.
 *
 * `decodeCodexExecOutput` above decodes a complete byte array in one pass, so
 * a character split across two chunks resolves correctly. That does not hold
 * when each poll is decoded and appended on its own: a character straddling
 * the boundary would become U+FFFD before its remaining bytes ever arrive.
 * So hold back an incomplete trailing sequence and prepend it next time.
 */
export function decodeCodexExecStream(
  pending: Uint8Array,
  chunks: CodexExecChunk[],
): { text: string; pending: Uint8Array } {
  const ordered = [...chunks].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const pieces = ordered.map((chunk) => decodeBase64(chunk.dataBase64));
  const total =
    pending.byteLength +
    pieces.reduce((sum, piece) => sum + piece.byteLength, 0);
  const bytes = new Uint8Array(total);
  bytes.set(pending, 0);
  let offset = pending.byteLength;
  for (const piece of pieces) {
    bytes.set(piece, offset);
    offset += piece.byteLength;
  }

  const hold = incompleteTrailingBytes(bytes);
  const boundary = bytes.byteLength - hold;
  return {
    text: new TextDecoder("utf-8", { fatal: false }).decode(
      bytes.subarray(0, boundary),
    ),
    pending: bytes.slice(boundary),
  };
}

/**
 * How many trailing bytes belong to a UTF-8 character that has not finished
 * arriving. A sequence is at most four bytes, so looking back three is enough.
 */
function incompleteTrailingBytes(bytes: Uint8Array): number {
  for (let back = 1; back <= 3 && back <= bytes.byteLength; back += 1) {
    const byte = bytes[bytes.byteLength - back]!;
    if ((byte & 0b1100_0000) === 0b1000_0000) continue; // continuation byte
    const expected =
      (byte & 0b1000_0000) === 0
        ? 1
        : (byte & 0b1110_0000) === 0b1100_0000
          ? 2
          : (byte & 0b1111_0000) === 0b1110_0000
            ? 3
            : (byte & 0b1111_1000) === 0b1111_0000
              ? 4
              : 1; // invalid lead; let the decoder emit its replacement char
    return expected > back ? back : 0;
  }
  return 0;
}

export function encodePendingBytes(pending: Uint8Array): string {
  if (pending.byteLength === 0) return "";
  if (typeof Buffer !== "undefined") {
    return Buffer.from(pending).toString("base64");
  }
  return btoa(String.fromCharCode(...pending));
}

export function decodePendingBytes(value: string): Uint8Array {
  return value ? decodeBase64(value) : new Uint8Array(0);
}
