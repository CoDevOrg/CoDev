import { describe, expect, it } from "vitest";

import { canRunGen2Agent } from "./agent-policy";
import {
  decodeCodexExecOutput,
  decodeCodexExecStream,
  decodePendingBytes,
  encodePendingBytes,
  mergeCodexExecChunks,
  parseCodexExecOutput,
} from "./codex-output";

describe("gen2 agent policy", () => {
  it("only runs Codex on a ready instance", () => {
    expect(canRunGen2Agent("ready")).toBe(true);
    expect(canRunGen2Agent("pending")).toBe(false);
    expect(canRunGen2Agent("provisioning")).toBe(false);
    expect(canRunGen2Agent("failed")).toBe(false);
    expect(canRunGen2Agent("stopped")).toBe(false);
  });
});

describe("codex exec output", () => {
  it("decodes a UTF-8 character split across unordered chunks", () => {
    expect(
      decodeCodexExecOutput([
        { sequence: 2, dataBase64: Buffer.from([0xa9]).toString("base64") },
        { sequence: 0, dataBase64: Buffer.from("h").toString("base64") },
        { sequence: 1, dataBase64: Buffer.from([0xc3]).toString("base64") },
      ]),
    ).toBe("hé");
  });

  it("reads the last agent message and ignores pty noise", () => {
    const output = [
      "noise",
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "Listed the files." },
      }),
      JSON.stringify({ type: "turn.completed" }),
    ].join("\n");
    expect(parseCodexExecOutput(output)).toEqual({
      reply: "Listed the files.",
      failed: false,
    });
  });

  it("surfaces a Codex error event", () => {
    expect(
      parseCodexExecOutput(
        JSON.stringify({
          type: "error",
          error: { message: "auth expired" },
        }),
      ),
    ).toEqual({ reply: "auth expired", failed: true });
  });

  it("merges poll chunks by sequence without duplicates", () => {
    expect(
      mergeCodexExecChunks(
        [{ sequence: 0, dataBase64: "YQ==" }],
        [
          { sequence: 0, dataBase64: "YQ==" },
          { sequence: 1, dataBase64: "Yg==" },
        ],
      ),
    ).toEqual([
      { sequence: 0, dataBase64: "YQ==" },
      { sequence: 1, dataBase64: "Yg==" },
    ]);
  });
});

describe("decodeCodexExecStream", () => {
  const encoder = new TextEncoder();

  function chunk(sequence: number, bytes: Uint8Array<ArrayBufferLike>) {
    return {
      sequence,
      dataBase64: Buffer.from(bytes).toString("base64"),
    };
  }

  it("holds back a character split across two polls", () => {
    const bytes = encoder.encode("héllo"); // é is two bytes
    const first = decodeCodexExecStream(new Uint8Array(0), [
      chunk(1, bytes.subarray(0, 2)), // "h" + the lead byte of é
    ]);
    expect(first.text).toBe("h");
    expect(first.pending.byteLength).toBe(1);

    const second = decodeCodexExecStream(first.pending, [
      chunk(2, bytes.subarray(2)),
    ]);
    expect(second.text).toBe("éllo");
    expect(second.pending.byteLength).toBe(0);
  });

  it("emits everything when the last character is complete", () => {
    const result = decodeCodexExecStream(new Uint8Array(0), [
      chunk(1, encoder.encode("done\n")),
    ]);
    expect(result.text).toBe("done\n");
    expect(result.pending.byteLength).toBe(0);
  });

  it("reassembles a four-byte character split three ways", () => {
    const bytes = encoder.encode("🙂");
    let pending: Uint8Array = new Uint8Array(0);
    let text = "";
    for (const [index, end] of [1, 3, 4].entries()) {
      const start = index === 0 ? 0 : [1, 3][index - 1]!;
      const result = decodeCodexExecStream(pending, [
        chunk(index + 1, bytes.subarray(start, end)),
      ]);
      text += result.text;
      pending = result.pending;
    }
    expect(text).toBe("🙂");
    expect(pending.byteLength).toBe(0);
  });

  it("round-trips pending bytes through storage", () => {
    const pending = encoder.encode("é").subarray(0, 1);
    expect(decodePendingBytes(encodePendingBytes(pending))).toEqual(pending);
    expect(decodePendingBytes("")).toEqual(new Uint8Array(0));
  });
});
