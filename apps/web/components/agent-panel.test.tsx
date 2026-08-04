import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentPanel,
  getAgentPollDelay,
  MAX_PARALLEL_AGENT_SESSIONS,
  type WorktreeReview,
  type AgentSession,
} from "./agent-panel";

const session: AgentSession = {
  id: "session-1",
  name: "Improve workspace navigation",
  model: "Codex",
  status: "running",
  worktreeName: "agent/navigation",
  worktreeStatus: "active",
  issueNumber: null,
  issueTitle: null,
  issueUrl: null,
  reviewHeadSha: null,
  reviewBaseSha: null,
  reviewDiffDigest: null,
  reviewedAt: null,
  mergedAt: null,
  discardedAt: null,
  lastError: null,
  claims: [],
  messages: [],
  turns: [],
  events: [],
};

describe("AgentPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps sessions in a sidebar beside the active conversation", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sessions: [session], stateEvents: [] }),
      }),
    );

    render(
      <AgentPanel
        workspaceId="workspace-1"
        canMerge
        initialSessions={[session]}
      />,
    );

    expect(
      screen.getByRole("complementary", { name: "Chat sessions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Agent conversation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Improve workspace navigation/i }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("textbox", {
        name: "Message Improve workspace navigation",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Agent model" })).toHaveValue(
      "Codex",
    );
  });

  it("shows an in-progress tool as a readable activity row", () => {
    const activitySession: AgentSession = {
      ...session,
      events: [
        {
          id: "activity-1",
          type: "tool.called",
          payload: {
            name: "read_file",
            arguments: JSON.stringify({ path: "project.json" }),
          },
          createdAt: "2026-07-30T12:00:01.000Z",
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessions: [activitySession],
          stateEvents: [],
        }),
      }),
    );

    render(
      <AgentPanel
        workspaceId="workspace-1"
        canMerge
        initialSessions={[activitySession]}
      />,
    );

    expect(screen.getByText("Reading")).toBeInTheDocument();
    expect(screen.getByText("project.json")).toBeInTheDocument();
    expect(screen.queryByText(/tools?/i)).not.toBeInTheDocument();
  });

  it("shows readable labels for the recent GPT model catalog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessions: [],
          stateEvents: [],
          models: [
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
            "gpt-5.5",
            "gpt-5.4",
            "gpt-5.4-mini",
          ],
        }),
      }),
    );

    render(
      <AgentPanel
        workspaceId="workspace-1"
        canMerge
        initialSessions={[{ ...session, model: "gpt-5" }]}
      />,
    );

    expect(
      await screen.findByRole("option", { name: "5.6 Sol" }),
    ).toBeVisible();
    expect(screen.getByRole("option", { name: "5.6 Terra" })).toBeVisible();
    expect(screen.getByRole("option", { name: "5.6 Luna" })).toBeVisible();
    expect(screen.getByRole("option", { name: "5.4 Mini" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Agent model" })).toHaveValue(
      "gpt-5.6-luna",
    );
  });

  it("filters recent chats by name, model, or status", () => {
    const secondSession: AgentSession = {
      ...session,
      id: "session-2",
      name: "Run the test suite",
      model: "gpt-5.6-luna",
      status: "idle",
      worktreeName: "agent/tests",
      worktreeStatus: "frozen",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessions: [session, secondSession],
          stateEvents: [],
        }),
      }),
    );

    render(
      <AgentPanel
        workspaceId="workspace-1"
        canMerge
        initialSessions={[session, secondSession]}
      />,
    );

    expect(
      screen.getByRole("tab", { name: /Run the test suite/i }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search chats" }), {
      target: { value: "tests" },
    });

    expect(
      screen.queryByRole("tab", { name: /Improve workspace navigation/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Run the test suite/i }),
    ).toBeInTheDocument();
  });

  it("slows agent polling when sessions are idle", () => {
    expect(getAgentPollDelay([{ status: "running" }])).toBe(5_000);
    expect(getAgentPollDelay([{ status: "waiting" }])).toBe(5_000);
    expect(getAgentPollDelay([{ status: "idle" }])).toBe(30_000);
    expect(getAgentPollDelay([])).toBe(30_000);
  });

  it("allows three parallel sessions", () => {
    expect(MAX_PARALLEL_AGENT_SESSIONS).toBe(3);
  });

  it("sends image data separately from the visible prompt", async () => {
    const fetchMock = vi.fn().mockImplementation((_input, init) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          init?.method === "POST"
            ? { sessionId: "session-new" }
            : { sessions: [], stateEvents: [], models: ["gpt-5.6-luna"] },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPanel workspaceId="workspace-1" canMerge />);

    const file = new File(["image bytes"], "Screenshot.png", {
      type: "image/png",
    });
    fireEvent.change(
      screen.getByLabelText("Attach files", { selector: "input" }),
      {
        target: { files: [file] },
      },
    );
    await waitFor(() =>
      expect(screen.getByText("Screenshot.png")).toBeInTheDocument(),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Message the agent" }),
      {
        target: { value: "What is this image?" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === "POST"),
      ).toBe(true),
    );
    const postCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "POST",
    );
    const body = JSON.parse(postCall?.[1]?.body as string) as {
      prompt: string;
      attachments: { name: string; data?: string }[];
    };
    expect(body.prompt).toBe("What is this image?");
    expect(body.prompt).not.toContain("file-content");
    expect(body.attachments).toEqual([
      {
        name: "Screenshot.png",
        type: "image/png",
        size: 11,
        data: "aW1hZ2UgYnl0ZXM=",
      },
    ]);
  });

  it("deletes a chat after confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.fn().mockImplementation((_input, init) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          init?.method === "DELETE"
            ? null
            : { sessions: [], stateEvents: [], models: [] },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AgentPanel
        workspaceId="workspace-1"
        canMerge
        initialSessions={[session]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete Improve workspace navigation",
      }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/workspace-1/agents/session-1",
        { method: "DELETE" },
      );
      expect(screen.getByText("No conversations yet")).toBeInTheDocument();
    });
    expect(confirm).toHaveBeenCalledWith(
      'Delete "Improve workspace navigation"? This removes its conversation and worktree.',
    );
  });

  it("can start a review assistant from the review panel", async () => {
    const reviewed: WorktreeReview = {
      baseSha: "base",
      headSha: "head",
      diff: "diff --git a/app.ts b/app.ts\n+const answer = 42;",
      diffDigest: "digest",
    };
    const fetchMock = vi.fn().mockImplementation((input, init) =>
      Promise.resolve({
        ok: true,
        json: async () => {
          if (init?.method === "POST" && String(input).endsWith("/review")) {
            return { review: reviewed };
          }
          if (init?.method === "POST") return { sessionId: "review-session" };
          return {
            sessions: [session, { ...session, id: "review-session" }],
            stateEvents: [],
            models: [],
          };
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AgentPanel
        workspaceId="workspace-1"
        canMerge
        initialSessions={[session]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Ask review assistant" }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/workspace-1/agents",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const createCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === "/api/workspaces/workspace-1/agents" &&
        init?.method === "POST",
    );
    expect(createCall?.[1]?.body).toContain("diff --git a/app.ts b/app.ts");
  });

  it("includes dropped or selected text files in a new agent prompt", async () => {
    const fetchMock = vi.fn().mockImplementation((_input, init) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          init?.method === "POST"
            ? { sessionId: "session-2" }
            : { sessions: [], stateEvents: [], models: [] },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <AgentPanel workspaceId="workspace-1" canMerge initialSessions={[]} />,
    );
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();

    const file = new File(["const answer = 42;"], "draft.ts", {
      type: "text/typescript",
    });
    fireEvent.change(input!, { target: { files: [file] } });

    expect(await screen.findByText("draft.ts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([, options]) => options?.method === "POST",
      );
      expect(postCall?.[1]?.body).toContain("const answer = 42;");
    });
  });
});
