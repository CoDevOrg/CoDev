import { describe, expect, it, vi } from "vitest";

import {
  ChatGptShareFetchError,
  previewChatGptShare,
} from "./chatgpt-share-fetch";

const SHARE_ID = "share-123";
const SHARE_URL = `https://chatgpt.com/share/${SHARE_ID}`;

function conversationHtml() {
  const user = {
    id: "user",
    parent: null,
    children: ["assistant"],
    message: {
      id: "user",
      author: { role: "user" },
      content: { content_type: "text", parts: ["Question"] },
      create_time: 1_725_000_000.5,
      metadata: {},
    },
  };
  const assistant = {
    id: "assistant",
    parent: "user",
    children: [],
    message: {
      id: "assistant",
      author: { role: "assistant" },
      content: { content_type: "text", parts: ["Answer"] },
      create_time: 1_725_000_001.5,
      metadata: {},
    },
  };
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
    {
      props: {
        pageProps: {
          serverResponse: {
            data: {
              title: "Preview",
              mapping: { user, assistant },
            },
          },
        },
      },
    },
  )}</script></html>`;
}

function htmlResponse(body: string, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "text/html; charset=utf-8");
  }
  return new Response(body, { ...init, headers });
}

async function expectFetchError(
  promise: Promise<unknown>,
  code: ChatGptShareFetchError["code"],
) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ChatGptShareFetchError);
  expect(error).toMatchObject({ code });
}

describe("ChatGPT share preview fetching", () => {
  it("fetches and returns a clean provider-neutral preview", async () => {
    const fetchImplementation = vi.fn(async () =>
      htmlResponse(conversationHtml()),
    );

    const preview = await previewChatGptShare(SHARE_URL, {
      fetchImplementation,
    });

    expect(preview).toMatchObject({
      title: "Preview",
      source: { provider: "chatgpt", externalId: SHARE_ID, url: SHARE_URL },
    });
    expect(preview.messages.map((message) => message.text)).toEqual([
      "Question",
      "Answer",
    ]);
    expect(fetchImplementation).toHaveBeenCalledWith(
      new URL(SHARE_URL),
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        credentials: "omit",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("rejects unsupported URLs before fetching", async () => {
    const fetchImplementation = vi.fn();

    await expectFetchError(
      previewChatGptShare("https://example.com/share/private", {
        fetchImplementation,
      }),
      "invalid_url",
    );
    await expectFetchError(
      previewChatGptShare(`${SHARE_URL}/continue`, { fetchImplementation }),
      "invalid_url",
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("follows only allowlisted redirects for the same share", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 308,
          headers: { location: `https://chatgpt.com/share/${SHARE_ID}` },
        }),
      )
      .mockResolvedValueOnce(htmlResponse(conversationHtml()));

    const preview = await previewChatGptShare(
      `https://chat.openai.com/share/${SHARE_ID}`,
      { fetchImplementation },
    );

    expect(preview.messages).toHaveLength(2);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("rejects redirects outside ChatGPT", async () => {
    const fetchImplementation = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://example.com/collect" },
        }),
    );

    await expectFetchError(
      previewChatGptShare(SHARE_URL, { fetchImplementation }),
      "invalid_url",
    );
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("rejects unavailable and deleted shares distinctly", async () => {
    await expectFetchError(
      previewChatGptShare(SHARE_URL, {
        fetchImplementation: vi.fn(async () =>
          htmlResponse("Not found", { status: 404 }),
        ),
      }),
      "unavailable",
    );
    await expectFetchError(
      previewChatGptShare(SHARE_URL, {
        fetchImplementation: vi.fn(async () =>
          htmlResponse(
            '<script>streamController.enqueue("Conversation has been deleted. Start a new chat.")</script>',
          ),
        ),
      }),
      "unavailable",
    );
  });

  it("enforces declared and streamed response-size limits", async () => {
    await expectFetchError(
      previewChatGptShare(SHARE_URL, {
        maxResponseBytes: 32,
        fetchImplementation: vi.fn(async () =>
          htmlResponse("small", { headers: { "content-length": "33" } }),
        ),
      }),
      "response_too_large",
    );
    await expectFetchError(
      previewChatGptShare(SHARE_URL, {
        maxResponseBytes: 8,
        fetchImplementation: vi.fn(async () =>
          htmlResponse("this body is larger than eight bytes"),
        ),
      }),
      "response_too_large",
    );
  });

  it("rejects non-HTML and malformed successful responses", async () => {
    await expectFetchError(
      previewChatGptShare(SHARE_URL, {
        fetchImplementation: vi.fn(
          async () =>
            new Response("{}", {
              headers: { "content-type": "application/json" },
            }),
        ),
      }),
      "invalid_content_type",
    );
    await expectFetchError(
      previewChatGptShare(SHARE_URL, {
        fetchImplementation: vi.fn(async () => htmlResponse("<html></html>")),
      }),
      "invalid_conversation",
    );
  });

  it("maps fetch timeouts without exposing the underlying error", async () => {
    const timeout = new Error("socket details");
    timeout.name = "TimeoutError";

    await expectFetchError(
      previewChatGptShare(SHARE_URL, {
        fetchImplementation: vi.fn().mockRejectedValue(timeout),
      }),
      "timed_out",
    );
  });
});
