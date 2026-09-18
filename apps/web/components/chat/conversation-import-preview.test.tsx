import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationImportPreview } from "./conversation-import-preview";

const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

const shareUrl = "https://chatgpt.com/share/share-123";
const conversation = {
  source: {
    provider: "chatgpt",
    externalId: "share-123",
    url: shareUrl,
    model: "gpt-5",
    updatedAt: null,
  },
  title: "Architecture discussion",
  messages: [
    {
      sequence: 0,
      role: "user",
      authorName: "User",
      text: "How should this work?",
      sourceContentType: "text",
      createdAt: null,
      artifacts: [],
    },
    {
      sequence: 1,
      role: "assistant",
      authorName: "Assistant",
      text: "Use a portable conversation layer.",
      sourceContentType: "text",
      createdAt: null,
      artifacts: [
        {
          kind: "file",
          sourceUrl: "https://cdn.example.com/plan.pdf",
          filename: "plan.pdf",
          description: null,
          downloadable: true,
        },
      ],
    },
  ],
  warnings: [],
};

describe("ConversationImportPreview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    routerPush.mockReset();
  });

  it("creates a room from the source URL and opens it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ conversation }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            room: { id: "room-123", href: "/rooms/room-123" },
            created: true,
          }),
          { status: 201 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<ConversationImportPreview />);

    fireEvent.change(screen.getByLabelText("Public share link"), {
      target: { value: shareUrl },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview chat" }));
    await screen.findByRole("heading", { name: "Architecture discussion" });

    fireEvent.click(
      screen.getByRole("button", { name: "Create collaborative room" }),
    );

    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith("/rooms/room-123"),
    );
    expect(screen.getByRole("link", { name: "Open room" })).toHaveAttribute(
      "href",
      "/rooms/room-123",
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/conversation-imports",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ url: shareUrl }),
      }),
    );
  });

  it("keeps the preview visible when room creation fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ conversation }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "Could not save this room." }), {
            status: 500,
          }),
        ),
    );
    render(<ConversationImportPreview />);

    fireEvent.change(screen.getByLabelText("Public share link"), {
      target: { value: shareUrl },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview chat" }));
    await screen.findByRole("heading", { name: "Architecture discussion" });
    fireEvent.click(
      screen.getByRole("button", { name: "Create collaborative room" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save this room.",
    );
    expect(screen.getByText("How should this work?")).toBeInTheDocument();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("submits a share URL and renders the read-only transcript", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ conversation }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ConversationImportPreview />);

    fireEvent.change(screen.getByLabelText("Public share link"), {
      target: { value: `  ${shareUrl}  ` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview chat" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/conversation-imports/preview",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ url: shareUrl }),
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "Architecture discussion" }),
    ).toBeInTheDocument();
    expect(screen.getByText("How should this work?")).toBeInTheDocument();
    expect(
      screen.getByText("Use a portable conversation layer."),
    ).toBeInTheDocument();
    expect(screen.getByText("2 messages")).toBeInTheDocument();
    expect(screen.getByText("1 attachment")).toBeInTheDocument();
    expect(screen.getByText("plan.pdf")).toBeInTheDocument();
  });

  it("shows the endpoint's safe error and no transcript", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "The ChatGPT shared conversation is no longer available.",
            code: "unavailable",
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    render(<ConversationImportPreview />);

    fireEvent.change(screen.getByLabelText("Public share link"), {
      target: { value: shareUrl },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview chat" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The ChatGPT shared conversation is no longer available.",
    );
    expect(
      screen.queryByLabelText("Conversation messages"),
    ).not.toBeInTheDocument();
  });

  it("disables the form and announces progress while loading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    render(<ConversationImportPreview />);

    fireEvent.change(screen.getByLabelText("Public share link"), {
      target: { value: shareUrl },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview chat" }));

    expect(screen.getByRole("button", { name: "Previewing…" })).toBeDisabled();
    expect(
      screen.getByText("Fetching and cleaning the shared transcript…"),
    ).toHaveAttribute("role", "status");
  });
});
