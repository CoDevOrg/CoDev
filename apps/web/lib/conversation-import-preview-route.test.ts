import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  getApiUser: vi.fn(),
  previewChatGptShare: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiError: (error: unknown, status = 400) =>
    Response.json(
      {
        error: error instanceof Error ? error.message : "Request failed.",
      },
      { status },
    ),
  getApiUser: mocks.getApiUser,
}));
vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
}));
vi.mock("@/lib/conversation-import/chatgpt-share-fetch", () => ({
  ChatGptShareFetchError: class ChatGptShareFetchError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status: number | null = null,
    ) {
      super(message);
    }
  },
  previewChatGptShare: mocks.previewChatGptShare,
}));

import { POST } from "@/app/api/conversation-imports/preview/route";
import {
  ChatGptShareFetchError,
  type ChatGptShareFetchErrorCode,
} from "@/lib/conversation-import/chatgpt-share-fetch";

const shareUrl = "https://chatgpt.com/share/share-123";
const conversation = {
  source: {
    provider: "chatgpt",
    externalId: "share-123",
    url: shareUrl,
    model: null,
    updatedAt: null,
  },
  title: "Preview",
  messages: [
    {
      sequence: 0,
      role: "user",
      authorName: "User",
      text: "Question",
      sourceContentType: "text",
      createdAt: null,
      artifacts: [],
    },
  ],
  warnings: [],
};

function request(body: unknown = { url: shareUrl }) {
  return new Request("https://codev.test/api/conversation-imports/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("conversation import preview route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiUser.mockResolvedValue({ id: "user-1" });
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 19,
      retryAfterSeconds: 0,
    });
    mocks.previewChatGptShare.mockResolvedValue(conversation);
  });

  it("requires an authenticated user", async () => {
    mocks.getApiUser.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.previewChatGptShare).not.toHaveBeenCalled();
  });

  it("returns the parsed conversation without persisting it", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ conversation });
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      "user-1",
      "conversation-import-preview",
      20,
      600,
    );
    expect(mocks.previewChatGptShare).toHaveBeenCalledWith(shareUrl);
  });

  it("rejects malformed JSON and invalid URLs", async () => {
    for (const body of [
      "{",
      { url: "not-a-url" },
      { url: shareUrl, extra: true },
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "invalid_request",
      });
    }
    expect(mocks.previewChatGptShare).not.toHaveBeenCalled();
  });

  it("rate limits preview requests before fetching ChatGPT", async () => {
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 420,
    });

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("420");
    expect(mocks.previewChatGptShare).not.toHaveBeenCalled();
  });

  it.each<[ChatGptShareFetchErrorCode, number]>([
    ["invalid_url", 400],
    ["invalid_conversation", 400],
    ["unavailable", 404],
    ["response_too_large", 413],
    ["upstream_error", 502],
    ["invalid_content_type", 502],
    ["timed_out", 504],
  ])("maps %s failures to HTTP %s", async (code, status) => {
    mocks.previewChatGptShare.mockRejectedValue(
      new ChatGptShareFetchError(code, "Safe import error."),
    );

    const response = await POST(request());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({
      error: "Safe import error.",
      code,
    });
  });

  it("does not expose unexpected server errors", async () => {
    mocks.previewChatGptShare.mockRejectedValue(
      new Error("secret upstream detail"),
    );

    const response = await POST(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "The conversation preview could not be created.",
    });
  });
});
