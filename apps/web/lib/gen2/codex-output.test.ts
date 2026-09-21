import { describe, expect, it } from "vitest";

import { canRunGen2Agent } from "./agent-policy";
import {
  decodeCodexExecOutput,
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
