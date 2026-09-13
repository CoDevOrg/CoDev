import { APICallError } from "ai";
import { describe, expect, it, vi } from "vitest";
import { ClaudeConnectionError } from "./claude-connection";
import { classifyRoomReplyError } from "./shared-chat-reply-error";

vi.mock("./claude-connection", () => ({
  ClaudeConnectionError: class extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
}));

describe("safe room reply failures", () => {
  const apiError = (statusCode: number) =>
    new APICallError({
      message: "private provider diagnostic",
      url: "https://api.anthropic.com/v1/messages",
      requestBodyValues: { secret: "private-token", prompt: "private chat" },
      statusCode,
      responseBody: "private response",
    });

  it("distinguishes provider rate limits from a disconnected subscription", () => {
    const failure = classifyRoomReplyError(apiError(429));
    expect(failure.category).toBe("provider_rate_limit");
    expect(failure.message).toContain("does not confirm");
    expect(JSON.stringify(failure)).not.toContain("private");
  });

  it.each([401, 403])("identifies authentication rejection %s", (status) => {
    expect(classifyRoomReplyError(apiError(status)).category).toBe(
      "provider_authentication",
    );
  });

  it("distinguishes an execution lease from provider rate limits", () => {
    expect(
      classifyRoomReplyError(new ClaudeConnectionError("private", 429))
        .category,
    ).toBe("subscription_busy");
  });

  it("does not expose arbitrary errors or response bodies", () => {
    for (const error of [apiError(500), new Error("private credentials")]) {
      expect(JSON.stringify(classifyRoomReplyError(error))).not.toContain(
        "private",
      );
    }
  });
});
