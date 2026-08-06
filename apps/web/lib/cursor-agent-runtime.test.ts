import { describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());

vi.mock("@cursor/sdk", () => ({
  Agent: { create },
}));

import {
  requireCursorApiKey,
  runCursorCloudAgent,
} from "./cursor-agent-runtime";

describe("cursor agent runtime", () => {
  it("requires a Cursor API key credential", () => {
    expect(() =>
      requireCursorApiKey({
        provider: "openai",
        source: "USER",
        authType: "API_KEY",
        apiKeyOrToken: "sk-test",
      }),
    ).toThrow(/Expected a Cursor credential/);

    expect(
      requireCursorApiKey({
        provider: "cursor",
        source: "USER",
        authType: "API_KEY",
        apiKeyOrToken: "key_test_cursor_abcdefgh",
      }),
    ).toBe("key_test_cursor_abcdefgh");
  });

  it("runs a Cursor cloud agent against the workspace repository", async () => {
    const events = [
      {
        type: "assistant" as const,
        message: {
          role: "assistant" as const,
          content: [{ type: "text" as const, text: "Done." }],
        },
      },
    ];
    const run = {
      stream: async function* () {
        for (const event of events) yield event;
      },
      wait: vi.fn(async () => ({
        id: "run-1",
        status: "finished",
        result: "Done.",
      })),
      cancel: vi.fn(),
    };
    const agent = {
      agentId: "bc-test",
      send: vi.fn(async () => run),
      [Symbol.asyncDispose]: vi.fn(async () => undefined),
    };
    create.mockResolvedValue(agent);

    const progress: string[] = [];
    const result = await runCursorCloudAgent({
      apiKey: "key_test_cursor_abcdefgh",
      model: "composer-2.5",
      repository: "acme/demo",
      startingRef: "abc123",
      prompt: "Fix the bug",
      onEvent: (event) => {
        if (event.kind === "text") progress.push(event.text);
      },
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "key_test_cursor_abcdefgh",
        model: { id: "composer-2.5" },
        cloud: {
          repos: [
            {
              url: "https://github.com/acme/demo",
              startingRef: "abc123",
            },
          ],
        },
      }),
    );
    expect(result.output).toBe("Done.");
    expect(progress).toContain("Done.");
  });
});
