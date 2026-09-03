import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SharedChatRoom } from "./shared-chat-room";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const room = {
  id: "room-123",
  ownerId: "user-1",
  viewerRole: "owner" as const,
  createdAt: "2026-09-02T12:00:00.000Z",
  members: [
    {
      userId: "user-1",
      name: "Qais",
      login: "qais",
      avatarUrl: null,
      role: "owner" as const,
      joinedAt: "2026-09-02T12:00:00.000Z",
    },
    {
      userId: "user-2",
      name: "Jordan",
      login: "jordan",
      avatarUrl: null,
      role: "member" as const,
      joinedAt: "2026-09-02T12:05:00.000Z",
    },
  ],
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
    expect(screen.getByText("2 members")).toBeInTheDocument();
    expect(screen.getByText("Qais")).toBeInTheDocument();
    expect(screen.getByText("Jordan")).toBeInTheDocument();
    expect(
      screen.getByText(/Create an invite link to bring another authenticated/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Invite people" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Add to the conversation"),
    ).toBeInTheDocument();
  });

  it("lets members contribute without exposing owner invite controls", () => {
    render(<SharedChatRoom room={{ ...room, viewerRole: "member" }} />);

    expect(
      screen.getByLabelText("Add to the conversation"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Invite people" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/can contribute to its conversation/),
    ).toBeInTheDocument();
  });
});
