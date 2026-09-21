import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Gen2WorkspaceDetail } from "@codev/contracts";

import { Gen2AgentPanel } from "./agent-panel";

const workspace: Gen2WorkspaceDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Studio",
  status: "ready",
  sandboxId: "sandbox-1",
  lastError: null,
  role: "owner",
  createdAt: "2026-09-20T20:00:00.000Z",
  updatedAt: "2026-09-20T20:00:00.000Z",
  members: [
    {
      userId: "22222222-2222-4222-8222-222222222222",
      login: "ada",
      name: "Ada",
      role: "owner",
    },
  ],
};

const chatOne = {
  id: "44444444-4444-4444-8444-444444444444",
  title: "List the files",
  createdAt: "2026-09-20T20:00:00.000Z",
  updatedAt: "2026-09-20T21:00:00.000Z",
};

const chatTwo = {
  id: "55555555-5555-4555-8555-555555555555",
  title: "Add a notes file",
  createdAt: "2026-09-20T19:00:00.000Z",
  updatedAt: "2026-09-20T19:30:00.000Z",
};

const replyEvent = JSON.stringify({
  type: "item.completed",
  item: { type: "agent_message", text: "Created notes.md." },
});

describe("Gen2AgentPanel", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/gen2/studio");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const path = String(url);
        const method = init?.method ?? "GET";
        if (path.endsWith("/chats") && method === "GET") {
          return {
            ok: true,
            json: async () => ({ chats: [chatOne, chatTwo] }),
          };
        }
        if (path.endsWith("/chats") && method === "POST") {
          return {
            ok: true,
            json: async () => ({
              chat: {
                id: "66666666-6666-4666-8666-666666666666",
                title: "New chat",
                createdAt: "2026-09-20T22:00:00.000Z",
                updatedAt: "2026-09-20T22:00:00.000Z",
              },
            }),
          };
        }
        if (path.endsWith(`/chats/${chatTwo.id}`)) {
          return {
            ok: true,
            json: async () => ({
              chat: {
                ...chatTwo,
                messages: [
                  {
                    id: "77777777-7777-4777-8777-777777777777",
                    role: "user",
                    body: "Add a notes file",
                    createdAt: "2026-09-20T19:00:00.000Z",
                  },
                  {
                    id: "88888888-8888-4888-8888-888888888888",
                    role: "assistant",
                    body: "Created notes.md.",
                    createdAt: "2026-09-20T19:01:00.000Z",
                  },
                ],
              },
            }),
          };
        }
        if (path.includes("/chats/") && method === "GET") {
          return {
            ok: true,
            json: async () => ({
              chat: { ...chatOne, messages: [] },
            }),
          };
        }
        if (path.endsWith("/agent") && method === "POST") {
          return {
            ok: true,
            json: async () => ({ sessionId: "session-1" }),
          };
        }
        if (path.endsWith("/agent/poll")) {
          return {
            ok: true,
            json: async () => ({
              chunks: [
                {
                  sequence: 0,
                  dataBase64: Buffer.from(replyEvent).toString("base64"),
                },
              ],
              nextSequence: 1,
              exited: true,
              exitCode: 0,
            }),
          };
        }
        return { ok: true, json: async () => ({ ok: true }) };
      }),
    );
  });

  it("keeps the composer closed until the instance is running", async () => {
    render(<Gen2AgentPanel workspace={{ ...workspace, status: "pending" }} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "New chat" })).toBeEnabled(),
    );
    expect(screen.getByLabelText("Message")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(
      screen.getByPlaceholderText("Start the instance first"),
    ).toBeInTheDocument();
  });

  it("lets you type in the Codex prompt when the instance is running", async () => {
    render(<Gen2AgentPanel workspace={workspace} />);
    const field = screen.getByLabelText("Message");
    await waitFor(() => expect(field).toBeEnabled());
    expect(
      screen.getByPlaceholderText("Ask Codex to inspect or change files here."),
    ).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "List the files" } });
    expect(field).toHaveValue("List the files");
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("lists chats on the workspace and opens another thread", async () => {
    render(<Gen2AgentPanel workspace={workspace} />);
    expect(
      await screen.findByRole("button", { name: "List the files" }),
    ).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: "Add a notes file" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Add a notes file" }),
      ).toHaveAttribute("aria-current", "true"),
    );
    expect(
      screen.getByText((content, element) => {
        return element?.tagName === "P" && content === "Add a notes file";
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Created notes.md.")).toBeInTheDocument();
  });

  it("sends a prompt on the selected chat and shows the Codex reply", async () => {
    render(<Gen2AgentPanel workspace={workspace} />);
    const field = screen.getByLabelText("Message");
    await waitFor(() => expect(field).toBeEnabled());
    fireEvent.change(field, { target: { value: "Add a notes file" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/api/gen2/workspaces/${workspace.id}/agent`,
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(chatOne.id),
        }),
      ),
    );
    expect(await screen.findByText("Created notes.md.")).toBeInTheDocument();
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/api/gen2/workspaces/${workspace.id}/chats/${chatOne.id}/messages`,
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("Created notes.md."),
        }),
      ),
    );
    expect(screen.getByLabelText("Reply")).toHaveAttribute(
      "placeholder",
      "Reply to Codex in this chat…",
    );
    expect(
      screen.getByText("You can keep talking in this chat."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/must-not-escape/)).not.toBeInTheDocument();
  });

  it("rejects a poll that includes auth material", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const path = String(url);
        const method = init?.method ?? "GET";
        if (path.endsWith("/chats") && method === "GET") {
          return {
            ok: true,
            json: async () => ({ chats: [chatOne] }),
          };
        }
        if (path.includes("/chats/") && method === "GET") {
          return {
            ok: true,
            json: async () => ({ chat: { ...chatOne, messages: [] } }),
          };
        }
        if (path.endsWith("/agent") && method === "POST") {
          return {
            ok: true,
            json: async () => ({ sessionId: "session-1" }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            chunks: [],
            nextSequence: 0,
            exited: true,
            exitCode: 0,
            codexAuthCacheJson: "must-not-escape",
          }),
        };
      }),
    );
    render(<Gen2AgentPanel workspace={workspace} />);
    const field = screen.getByLabelText("Message");
    await waitFor(() => expect(field).toBeEnabled());
    fireEvent.change(field, { target: { value: "List files" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Unexpected auth material/,
    );
    expect(screen.queryByText("must-not-escape")).not.toBeInTheDocument();
  });
});
