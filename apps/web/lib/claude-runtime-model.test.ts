import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
const complete = vi.hoisted(() => vi.fn());
vi.mock("./claude-runtime-execution", () => ({
  completeClaudeExecution: complete,
}));
import { createClaudeRuntimeModel } from "./claude-runtime-model";
beforeEach(() => vi.resetAllMocks());
describe("official CLI workspace model bridge", () => {
  it("rejects attachments explicitly instead of serializing binary data as text", async () => {
    const model = createClaudeRuntimeModel("sender", "sonnet");
    await expect(
      model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [
              {
                type: "file",
                mediaType: "image/png",
                data: new Uint8Array([1, 2, 3]),
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/text only/);
    expect(complete).not.toHaveBeenCalled();
  });
  it("keeps the streaming endpoint compatible with native completion", async () => {
    complete.mockResolvedValue({
      structured_output: { text: "Hello", calls: [] },
    });
    const result = await createClaudeRuntimeModel("sender", "sonnet").doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    });
    const reader = result.stream.getReader();
    const events = [];
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      events.push(next.value);
    }
    expect(events).toContainEqual(
      expect.objectContaining({ type: "text-delta", delta: "Hello" }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "finish",
      finishReason: { unified: "stop" },
    });
  });
  it("uses the existing AI SDK tool validation and execution loop", async () => {
    complete.mockResolvedValueOnce({
      structured_output: {
        text: "Inspecting",
        calls: [{ name: "inspect", inputJson: '{"path":"README.md"}' }],
      },
    });
    complete.mockResolvedValueOnce({
      structured_output: { text: "Done", calls: [] },
    });
    const inspect = vi.fn(async () => "workspace file contents");
    const result = await generateText({
      model: createClaudeRuntimeModel("sender", "sonnet"),
      prompt: "Inspect the README",
      maxRetries: 0,
      stopWhen: stepCountIs(3),
      tools: {
        inspect: tool({
          inputSchema: z.object({ path: z.string() }),
          execute: inspect,
        }),
      },
    });
    expect(result.text).toBe("Done");
    expect(inspect).toHaveBeenCalledWith(
      { path: "README.md" },
      expect.anything(),
    );
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]![2]).toContain("workspace file contents");
    expect(complete.mock.calls[0]![0]).toBe("sender");
  });
  it("rejects invented tools instead of giving the private runtime filesystem access", async () => {
    complete.mockResolvedValue({
      structured_output: {
        text: "",
        calls: [{ name: "read_private_credentials", inputJson: "{}" }],
      },
    });
    await expect(
      generateText({
        model: createClaudeRuntimeModel("sender", "sonnet"),
        prompt: "hello",
        maxRetries: 0,
      }),
    ).rejects.toThrow(/unavailable tool/);
  });
});
