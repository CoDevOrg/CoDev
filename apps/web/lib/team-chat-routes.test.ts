import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  listWorkspaceChannels: vi.fn(),
  createWorkspaceChannel: vi.fn(),
  listChannelMessages: vi.fn(),
  postChannelMessage: vi.fn(),
  markChannelRead: vi.fn(),
  dispatchAgentMention: vi.fn(),
  getTeamRoster: vi.fn(),
  setMemberStatus: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiError: (error: unknown, status = 400) =>
    Response.json(
      { error: error instanceof Error ? error.message : "request failed" },
      { status },
    ),
  getApiUser: mocks.getApiUser,
}));
vi.mock("@/lib/access", () => ({
  requireWorkspacePermission: mocks.requireWorkspacePermission,
}));
vi.mock("@/lib/team-chat", async () => {
  const errors = await import("./team-chat-error");
  return {
    TeamChatError: errors.TeamChatError,
    listWorkspaceChannels: mocks.listWorkspaceChannels,
    createWorkspaceChannel: mocks.createWorkspaceChannel,
    listChannelMessages: mocks.listChannelMessages,
    postChannelMessage: mocks.postChannelMessage,
    markChannelRead: mocks.markChannelRead,
  };
});
vi.mock("@/lib/team-chat-agent", () => ({
  dispatchAgentMention: mocks.dispatchAgentMention,
}));
vi.mock("@/lib/team-roster", () => ({
  getTeamRoster: mocks.getTeamRoster,
  setMemberStatus: mocks.setMemberStatus,
}));

import { TeamChatError } from "./team-chat-error";

import {
  GET as getChannels,
  POST as createChannelRoute,
} from "@/app/api/workspaces/[workspaceId]/channels/route";
import {
  GET as getMessages,
  POST as postMessage,
} from "@/app/api/workspaces/[workspaceId]/channels/[channelId]/messages/route";
import {
  GET as getTeam,
  POST as postStatus,
} from "@/app/api/workspaces/[workspaceId]/team/route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const channelId = "ba0f5f8a-8fd1-4a53-9f1a-3f5f4b6b0f21";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const channel = {
  id: channelId,
  slug: "general",
  topic: null,
  agentAccess: true,
};

function params() {
  return { params: Promise.resolve({ workspaceId }) };
}

function messageParams() {
  return { params: Promise.resolve({ workspaceId, channelId }) };
}

function postRequest(body: unknown) {
  return new Request("http://codev.test", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("team chat routes", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId, name: "Jordan Lee" });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.listWorkspaceChannels.mockResolvedValue([
      { id: channelId, slug: "general", unreadCount: 2 },
    ]);
    mocks.createWorkspaceChannel.mockResolvedValue({
      id: channelId,
      slug: "deploys",
    });
    mocks.listChannelMessages.mockResolvedValue({ channel, messages: [] });
    mocks.postChannelMessage.mockResolvedValue({
      channel,
      message: {
        id: "m1",
        body: "hello",
        mentionsAgent: false,
        author: { id: userId, login: "jordan", name: "Jordan Lee" },
      },
    });
    mocks.markChannelRead.mockResolvedValue(undefined);
    mocks.dispatchAgentMention.mockResolvedValue({
      dispatched: true,
      sessionId: "s1",
    });
    mocks.getTeamRoster.mockResolvedValue({
      viewerId: userId,
      members: [],
      agents: [],
    });
    mocks.setMemberStatus.mockResolvedValue({
      headline: "Shipping",
      emoji: "🚀",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication before touching a workspace", async () => {
    mocks.getApiUser.mockResolvedValue(null);
    const response = await getChannels(
      new Request("http://codev.test"),
      params(),
    );
    expect(response.status).toBe(401);
    expect(mocks.listWorkspaceChannels).not.toHaveBeenCalled();
  });

  it("lists channels for any member who can view the workspace", async () => {
    const response = await getChannels(
      new Request("http://codev.test"),
      params(),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      channels: [{ id: channelId, slug: "general", unreadCount: 2 }],
    });
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "view",
    );
  });

  it("requires edit rights to add a channel", async () => {
    await createChannelRoute(postRequest({ slug: "deploys" }), params());
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "edit",
    );
  });

  it("rejects a channel name that is not a slug", async () => {
    const response = await createChannelRoute(
      postRequest({ slug: "Not A Slug" }),
      params(),
    );
    expect(response.status).toBe(400);
    expect(mocks.createWorkspaceChannel).not.toHaveBeenCalled();
  });

  it("reports a duplicate channel as a conflict", async () => {
    mocks.createWorkspaceChannel.mockRejectedValue(
      new TeamChatError("#deploys already exists.", 409),
    );
    const response = await createChannelRoute(
      postRequest({ slug: "deploys" }),
      params(),
    );
    expect(response.status).toBe(409);
  });

  it("marks a channel read when its first page is opened", async () => {
    const response = await getMessages(
      new Request("http://codev.test"),
      messageParams(),
    );
    expect(response.status).toBe(200);
    expect(mocks.markChannelRead).toHaveBeenCalledWith(channelId, userId);
  });

  it("does not mark read while paging back through history", async () => {
    await getMessages(
      new Request("http://codev.test?before=2026-08-28T03:00:00.000Z"),
      messageParams(),
    );
    expect(mocks.markChannelRead).not.toHaveBeenCalled();
    expect(mocks.listChannelMessages).toHaveBeenCalledWith(
      workspaceId,
      channelId,
      { before: "2026-08-28T03:00:00.000Z" },
    );
  });

  it("posts a message and leaves the agent alone when it was not mentioned", async () => {
    const response = await postMessage(
      postRequest({ body: "morning all" }),
      messageParams(),
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      agentDispatch: null,
    });
    expect(mocks.dispatchAgentMention).not.toHaveBeenCalled();
  });

  it("hands an @agent mention to a running agent with the channel name", async () => {
    mocks.postChannelMessage.mockResolvedValue({
      channel,
      message: {
        id: "m2",
        body: "@agent please fix the failing test",
        mentionsAgent: true,
        author: { id: userId, login: "jordan", name: "Jordan Lee" },
      },
    });

    const response = await postMessage(
      postRequest({ body: "@agent please fix the failing test" }),
      messageParams(),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      agentDispatch: { dispatched: true, sessionId: "s1" },
    });
    expect(mocks.dispatchAgentMention).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        channelSlug: "general",
        authorName: "Jordan Lee",
      }),
    );
  });

  it("still posts the message when the agent cannot be reached", async () => {
    mocks.postChannelMessage.mockResolvedValue({
      channel,
      message: {
        id: "m3",
        body: "@agent hi",
        mentionsAgent: true,
        author: null,
      },
    });
    mocks.dispatchAgentMention.mockResolvedValue({
      dispatched: false,
      reason: "No agent session is running.",
    });

    const response = await postMessage(
      postRequest({ body: "@agent hi" }),
      messageParams(),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      message: { id: "m3" },
      agentDispatch: { dispatched: false },
    });
  });

  it("returns 404 for a channel from another workspace", async () => {
    mocks.listChannelMessages.mockRejectedValue(
      new TeamChatError("Channel not found.", 404),
    );
    const response = await getMessages(
      new Request("http://codev.test"),
      messageParams(),
    );
    expect(response.status).toBe(404);
  });

  it("returns the roster and saves only the caller's own status", async () => {
    const rosterResponse = await getTeam(
      new Request("http://codev.test"),
      params(),
    );
    expect(rosterResponse.status).toBe(200);

    const statusResponse = await postStatus(
      postRequest({ headline: "Shipping", emoji: "🚀" }),
      params(),
    );
    expect(statusResponse.status).toBe(200);
    expect(mocks.setMemberStatus).toHaveBeenCalledWith(workspaceId, userId, {
      headline: "Shipping",
      emoji: "🚀",
    });
  });
});
