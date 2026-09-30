/**
 * Transport only: bytes and chunk sequencing for an agent process's output.
 * Nothing here knows what the bytes mean. Each provider's output format is
 * read by its own reducer (`turn-events.ts`, `claude-turn-events.ts`), chosen
 * in `turn-reducer.ts`.
 */

export type AgentExecChunk = {
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
export function decodeAgentExecOutput(chunks: AgentExecChunk[]): string {
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

export function mergeAgentExecChunks(
  existing: AgentExecChunk[],
  incoming: AgentExecChunk[],
): AgentExecChunk[] {
  const bySequence = new Map<number, AgentExecChunk>();
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
 * `decodeAgentExecOutput` above decodes a complete byte array in one pass, so
 * a character split across two chunks resolves correctly. That does not hold
 * when each poll is decoded and appended on its own: a character straddling
 * the boundary would become U+FFFD before its remaining bytes ever arrive.
 * So hold back an incomplete trailing sequence and prepend it next time.
 */
export function decodeAgentExecStream(
  pending: Uint8Array,
  chunks: AgentExecChunk[],
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

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Adapts a Superset terminal-agent poll's plain-text, full-snapshot chunks
 * (see `superset-agent-orchestrator-client.ts`) into the `AgentExecChunk[]`
 * shape the browser's `chat-panel.tsx` already merges by `sequence` and
 * decodes for a live in-progress reply. Always emitting `sequence: 0` -- one
 * chunk representing "the current full snapshot" -- makes `mergeAgentExecChunks`
 * overwrite that one entry each poll instead of concatenating an
 * ever-growing series of duplicate snapshots.
 */
export function toAgentExecChunks(
  chunks: { sequence: number; data: string }[],
): AgentExecChunk[] {
  if (chunks.length === 0) return [];
  const latest = chunks.reduce((max, chunk) =>
    chunk.sequence > max.sequence ? chunk : max,
  );
  return [{ sequence: 0, dataBase64: encodeBase64(latest.data) }];
}
