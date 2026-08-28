import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorkspaceAccess: vi.fn(),
  enqueueSharedSessionInstruction: vi.fn(),
  readTeamChatContext: vi.fn(),
  sessionRows: [] as Array<{ id: string }>,
}));

vi.mock("@/lib/access", () => ({
  getWorkspaceAccess: mocks.getWorkspaceAccess,
}));
vi.mock("@/lib/shared-session-server", () => ({
  enqueueSharedSessionInstruction: mocks.enqueueSharedSessionInstruction,
}));
vi.mock("@/lib/team-chat", () => ({
  readTeamChatContext: mocks.readTeamChatContext,
}));
vi.mock("@/lib/database", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "orderBy"]) {
    chain[method] = () => chain;
  }
  chain.limit = () => Promise.resolve(mocks.sessionRows);
  return { getDatabase: () => chain };
});

import {
  buildAgentMentionPrompt,
  dispatchAgentMention,
} from "./team-chat-agent";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const user = { id: "2f2387ed-4a63-4b05-88cc-266d65f7b82b", name: "Jordan Lee" };

describe("buildAgentMentionPrompt", () => {
  it("tells the agent where the question came from and where to answer", () => {
    const prompt = buildAgentMentionPrompt({
      channelSlug: "general",
      authorName: "Jordan Lee",
      body: "@agent why is the build red?",
      digest: "#general\n[t] Jordan Lee: @agent why is the build red?",
    });

    expect(prompt).toContain("Jordan Lee mentioned you");
    expect(prompt).toContain("#general");
    expect(prompt).toContain("@agent why is the build red?");
    expect(prompt).toContain("post_team_chat");
  });
});

describe("dispatchAgentMention", () => {
  beforeEach(() => {
    mocks.sessionRows = [{ id: "5c9c5f7e-2b3a-4d6f-9c0e-1a2b3c4d5e6f" }];
    mocks.getWorkspaceAccess.mockResolvedValue({
      role: "co_steer",
      permissions: { coSteer: true },
    });
    mocks.readTeamChatContext.mockResolvedValue({
      channels: [],
      digest: "#general\n[t] Jordan Lee: hello",
    });
    mocks.enqueueSharedSessionInstruction.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function dispatch() {
    return dispatchAgentMention({
      workspaceId,
      channelSlug: "general",
      authorName: "Jordan Lee",
      body: "@agent take a look",
      user,
    });
  }

  it("queues the mention on the most recent live session", async () => {
    await expect(dispatch()).resolves.toEqual({
      dispatched: true,
      sessionId: "5c9c5f7e-2b3a-4d6f-9c0e-1a2b3c4d5e6f",
    });
    expect(mocks.enqueueSharedSessionInstruction).toHaveBeenCalledWith(
      workspaceId,
      "5c9c5f7e-2b3a-4d6f-9c0e-1a2b3c4d5e6f",
      user,
      expect.stringContaining("#general"),
    );
  });

  it("declines when the member's role cannot instruct agents", async () => {
    mocks.getWorkspaceAccess.mockResolvedValue({
      role: "viewer",
      permissions: { coSteer: false },
    });
    await expect(dispatch()).resolves.toEqual({
      dispatched: false,
      reason: "Your role cannot send instructions to agents.",
    });
    expect(mocks.enqueueSharedSessionInstruction).not.toHaveBeenCalled();
  });

  it("reports plainly when no agent is running", async () => {
    mocks.sessionRows = [];
    await expect(dispatch()).resolves.toEqual({
      dispatched: false,
      reason: "No agent session is running.",
    });
  });

  it("never throws: a failed hand-off must not lose the posted message", async () => {
    mocks.enqueueSharedSessionInstruction.mockRejectedValue(
      new Error("Provider connection required."),
    );
    await expect(dispatch()).resolves.toEqual({
      dispatched: false,
      reason: "Provider connection required.",
    });
  });
});
