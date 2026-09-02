import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SharedChatRoom } from "./shared-chat-room";

const room = {
  id: "room-123",
  ownerId: "user-1",
  viewerRole: "owner",
  createdAt: "2026-09-02T12:00:00.000Z",
  conversation: {
    source: {
      provider: "chatgpt",
      externalId: "share-123",
      url: "https://chatgpt.com/share/share-123",
      model: "gpt-5",
      updatedAt: null,
    },
    title: "Architecture discussion",
    messages: [
      {
        sequence: 0,
        role: "user" as const,
        authorName: "User",
        text: "How should this work?",
        sourceContentType: "text",
        createdAt: null,
        artifacts: [],
      },
      {
        sequence: 1,
        role: "assistant" as const,
        authorName: "Assistant",
        text: "Use a portable conversation layer.",
        sourceContentType: "text",
        createdAt: null,
        artifacts: [
          {
            kind: "file" as const,
            sourceUrl: "https://cdn.example.com/plan.pdf",
            filename: "plan.pdf",
            description: null,
            downloadable: true,
          },
        ],
      },
    ],
    warnings: [],
  },
};

describe("SharedChatRoom", () => {
  it("renders the persisted conversation and current access state", () => {
    render(<SharedChatRoom room={room} />);

    expect(
      screen.getByRole("heading", { name: "Architecture discussion" }),
    ).toBeInTheDocument();
    expect(screen.getByText("How should this work?")).toBeInTheDocument();
    expect(
      screen.getByText("Use a portable conversation layer."),
    ).toBeInTheDocument();
    expect(screen.getByText("plan.pdf")).toBeInTheDocument();
    expect(screen.getByText("Private")).toBeInTheDocument();
    expect(
      screen.getByText(/Only you can access it until member invitations/),
    ).toBeInTheDocument();
  });
});
