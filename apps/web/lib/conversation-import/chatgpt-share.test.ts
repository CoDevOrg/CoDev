import { describe, expect, it } from "vitest";

import {
  importChatGptShareHtml,
  normalizeChatGptShareConversation,
} from "./chatgpt-share";

function legacyShareHtml(data: Record<string, unknown>) {
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
    {
      props: { pageProps: { serverResponse: { data } } },
    },
  )}</script></html>`;
}

function modernShareHtml(data: Record<string, unknown>, shareId: string) {
  const pool = [
    null,
    "loaderData",
    {
      route: {
        sharedConversationId: shareId,
        serverResponse: { data },
      },
    },
  ];
  return `<html><script>streamController.enqueue(${JSON.stringify(
    `${JSON.stringify(pool)}\n`,
  )});</script></html>`;
}

function message(
  id: string,
  role: string,
  content: Record<string, unknown>,
  createdAt: number,
  metadata?: Record<string, unknown>,
) {
  return {
    id,
    message: {
      id,
      author: { role },
      content,
      create_time: createdAt,
      metadata: metadata ?? {},
    },
  };
}

describe("ChatGPT shared conversation normalization", () => {
  it("converts parser output into the provider-neutral import contract", () => {
    const normalized = normalizeChatGptShareConversation(
      {
        shareId: "share-123",
        aiModel: "gpt-5",
        title: " Planning a feature ",
        updatedAt: 1_725_000_000,
        replies: [
          {
            authorName: "You",
            type: "user",
            statement: "Help me plan this feature.",
            createdAt: 1_725_000_000_000,
            assets: [],
          },
          {
            authorName: "ChatGPT",
            type: "assistant",
            statement: "Here is a plan.",
            createdAt: null,
            assets: [
              {
                assetType: "image",
                url: "https://cdn.example.com/diagram.png",
                filename: "diagram.png",
                description: "A feature diagram",
                downloadable: true,
              },
            ],
          },
        ],
      },
      "https://chatgpt.com/share/share-123",
    );

    expect(normalized).toEqual({
      source: {
        provider: "chatgpt",
        externalId: "share-123",
        url: "https://chatgpt.com/share/share-123",
        model: "gpt-5",
        updatedAt: "2024-08-30T06:40:00.000Z",
      },
      title: "Planning a feature",
      messages: [
        {
          sequence: 0,
          role: "user",
          authorName: "You",
          text: "Help me plan this feature.",
          sourceContentType: null,
          createdAt: "2024-08-30T06:40:00.000Z",
          artifacts: [],
        },
        {
          sequence: 1,
          role: "assistant",
          authorName: "ChatGPT",
          text: "Here is a plan.",
          sourceContentType: null,
          createdAt: null,
          artifacts: [
            {
              kind: "image",
              sourceUrl: "https://cdn.example.com/diagram.png",
              filename: "diagram.png",
              description: "A feature diagram",
              downloadable: true,
            },
          ],
        },
      ],
      warnings: [],
    });
  });

  it("normalizes blank optional provider labels to null", () => {
    const normalized = normalizeChatGptShareConversation(
      {
        shareId: "share-blank-labels",
        aiModel: "",
        title: "Untitled model",
        updatedAt: null,
        replies: [
          {
            authorName: "",
            type: "tool",
            statement: "Tool result",
            createdAt: null,
            assets: [],
          },
        ],
      },
      "https://chatgpt.com/share/share-blank-labels",
    );

    expect(normalized.source.model).toBeNull();
    expect(normalized.messages[0]?.authorName).toBeNull();
  });

  it("rejects malformed parser output at the provider boundary", () => {
    expect(() =>
      normalizeChatGptShareConversation(
        {
          shareId: "share-invalid",
          aiModel: "gpt-5",
          title: "Invalid asset",
          updatedAt: null,
          replies: [
            {
              authorName: "ChatGPT",
              type: "assistant",
              statement: "Result",
              createdAt: null,
              assets: [{ assetType: "video", url: "not-a-url" }],
            },
          ],
        },
        "https://chatgpt.com/share/share-invalid",
      ),
    ).toThrow();
  });

  it("parses modern shares into clean messages while omitting reasoning by default", () => {
    const data = {
      title: "Architecture room",
      update_time: 1_725_000_100.5,
      model: { slug: "gpt-5" },
      linear_conversation: [
        message(
          "user-1",
          "user",
          { content_type: "text", parts: ["Design this );"] },
          1_725_000_000.5,
        ),
        message(
          "reasoning-1",
          "assistant",
          {
            content_type: "reasoning_recap",
            content: "Internal reasoning summary",
          },
          1_725_000_001.5,
        ),
        message(
          "assistant-code",
          "assistant",
          { content_type: "code", language: "ts", text: "const ready = true;" },
          1_725_000_002.5,
        ),
        message(
          "user-image",
          "user",
          {
            content_type: "multimodal_text",
            parts: [
              "Use this image",
              {
                content_type: "image_asset_pointer",
                asset_pointer: "https://cdn.example.com/design.png",
                mime_type: "image/png",
              },
            ],
          },
          1_725_000_003.5,
        ),
        message(
          "tool-1",
          "tool",
          { content_type: "tool_response", output: "Tool result" },
          1_725_000_004.5,
        ),
      ],
      mapping: {},
    };

    const imported = importChatGptShareHtml(
      modernShareHtml(data, "share-modern"),
      "https://chatgpt.com/share/share-modern",
    );

    expect(imported.source).toMatchObject({
      provider: "chatgpt",
      externalId: "share-modern",
      model: "gpt-5",
      updatedAt: "2024-08-30T06:41:40.500Z",
    });
    expect(imported.messages.map((entry) => entry.role)).toEqual([
      "user",
      "assistant",
      "user",
      "tool",
    ]);
    expect(imported.messages[1]).toMatchObject({
      text: "```ts\nconst ready = true;\n```",
      sourceContentType: "code",
    });
    expect(imported.messages[2]?.artifacts).toEqual([
      {
        kind: "image",
        sourceUrl: "https://cdn.example.com/design.png",
        filename: "user-0.png",
        description: null,
        downloadable: true,
      },
    ]);
  });

  it("parses legacy mapping trees and preserves file metadata", () => {
    const root = {
      id: "root",
      parent: null,
      children: ["user"],
      message: null,
    };
    const user = {
      ...message(
        "user",
        "user",
        { content_type: "text", parts: ["Review the document"] },
        1_725_000_000.5,
        {
          attachments: [
            {
              download_url: "https://cdn.example.com/brief.pdf",
              name: "brief.pdf",
              mime_type: "application/pdf",
              file_type: "file",
            },
          ],
        },
      ),
      parent: "root",
      children: ["assistant"],
    };
    const assistant = {
      ...message(
        "assistant",
        "assistant",
        { content_type: "text", parts: ["Reviewed."] },
        1_725_000_001.5,
      ),
      parent: "user",
      children: [],
    };

    const imported = importChatGptShareHtml(
      legacyShareHtml({
        title: "",
        conversation_id: "payload-id",
        update_time: 1_725_000_010.5,
        mapping: { root, user, assistant },
      }),
      "https://chat.openai.com/share/url-share-id",
    );

    expect(imported.source.externalId).toBe("url-share-id");
    expect(imported.title).toBe("Review the document");
    expect(imported.warnings).toEqual([
      "The legacy ChatGPT share format was used.",
      "Message order was reconstructed from the conversation tree.",
    ]);
    expect(imported.messages[0]?.artifacts[0]).toMatchObject({
      kind: "file",
      filename: "brief.pdf",
      downloadable: true,
    });
  });

  it("rejects unsupported links and pages without conversation data", () => {
    expect(() =>
      importChatGptShareHtml(
        "<html></html>",
        "https://example.com/share/not-chatgpt",
      ),
    ).toThrow();
    expect(() =>
      importChatGptShareHtml(
        "<html></html>",
        "https://chatgpt.com/share/missing",
      ),
    ).toThrow("No conversation payload");
  });
});
