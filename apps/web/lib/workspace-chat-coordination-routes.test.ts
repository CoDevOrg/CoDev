import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  heartbeatWorkspaceChat: vi.fn(),
  leaveWorkspaceChat: vi.fn(),
  acquireWorkspaceChatLease: vi.fn(),
  renewWorkspaceChatLease: vi.fn(),
  releaseWorkspaceChatLease: vi.fn(),
  recordWorkspaceChatPrompt: vi.fn(),
  loadWorkspaceChatSnapshot: vi.fn(),
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

vi.mock("@/lib/workspace-chat-coordination", () => ({
  WorkspaceChatCoordinationError: class WorkspaceChatCoordinationError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code: string,
    ) {
      super(message);
    }
  },
  heartbeatWorkspaceChat: mocks.heartbeatWorkspaceChat,
  leaveWorkspaceChat: mocks.leaveWorkspaceChat,
  acquireWorkspaceChatLease: mocks.acquireWorkspaceChatLease,
  renewWorkspaceChatLease: mocks.renewWorkspaceChatLease,
  releaseWorkspaceChatLease: mocks.releaseWorkspaceChatLease,
  recordWorkspaceChatPrompt: mocks.recordWorkspaceChatPrompt,
  loadWorkspaceChatSnapshot: mocks.loadWorkspaceChatSnapshot,
}));

import {
  GET,
  POST,
} from "@/app/api/workspaces/[workspaceId]/chat-coordination/route";
import { WorkspaceChatCoordinationError } from "./workspace-chat-coordination";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const clientId = "179c47e2-4c1b-4cef-8a1a-28be63b96a75";
const leaseToken = "fa9c7eeb-4e4c-46ad-b8dd-26edf84cf02a";
const clientMessageId = "24f86e42-ca12-4881-b5ef-37f234aac233";
const chatId = "terminal:tab-7";
const snapshot = {
  viewer: { id: userId, name: "Jordan Lee", avatarUrl: null },
  lease: null,
  participants: [{ id: userId, name: "Jordan Lee", avatarUrl: null }],
  receipts: [],
  serverTime: "2026-08-28T07:00:00.000Z",
};

function context() {
  return { params: Promise.resolve({ workspaceId }) };
}

function post(body: object) {
  return POST(
    new Request("https://codev.test", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    context(),
  );
}

describe("workspace chat coordination route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId, name: "Jordan Lee" });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.loadWorkspaceChatSnapshot.mockResolvedValue(snapshot);
    mocks.acquireWorkspaceChatLease.mockResolvedValue({
      leaseToken,
      expiresAt: "2026-08-28T07:00:30.000Z",
    });
    mocks.recordWorkspaceChatPrompt.mockResolvedValue({ id: "receipt-1" });
  });

  afterEach(() => vi.resetAllMocks());

  it("loads an attributed snapshot with view permission", async () => {
    const response = await GET(
      new Request(`https://codev.test?chatId=${encodeURIComponent(chatId)}`),
      context(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      viewer: { id: userId, name: "Jordan Lee" },
      participants: [{ id: userId }],
    });
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "view",
    );
  });

  it("acquires exclusive composer control with co-steer permission", async () => {
    const response = await post({ action: "acquire", chatId, clientId });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ leaseToken });
    expect(mocks.acquireWorkspaceChatLease).toHaveBeenCalledWith(
      workspaceId,
      chatId,
      userId,
      clientId,
    );
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "coSteer",
    );
  });

  it("records an image-only prompt before terminal delivery", async () => {
    const response = await post({
      action: "submit",
      chatId,
      clientId,
      leaseToken,
      clientMessageId,
      prompt: "",
      attachments: [{ name: "design.png", type: "image" }],
      provider: "claude",
      model: "sonnet",
      effort: "high",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      receiptId: "receipt-1",
    });
    expect(mocks.recordWorkspaceChatPrompt).toHaveBeenCalledWith({
      workspaceId,
      chatId,
      userId,
      clientId,
      leaseToken,
      clientMessageId,
      prompt: "",
      attachments: [{ name: "design.png", type: "image" }],
      provider: "claude",
      model: "sonnet",
      effort: "high",
    });
  });

  it("rejects malformed coordination identifiers", async () => {
    const response = await post({
      action: "acquire",
      chatId,
      clientId: "shared-browser-tab",
    });

    expect(response.status).toBe(400);
    expect(mocks.acquireWorkspaceChatLease).not.toHaveBeenCalled();
  });

  it("returns a stable conflict code when another member owns the composer", async () => {
    mocks.acquireWorkspaceChatLease.mockRejectedValueOnce(
      new WorkspaceChatCoordinationError(
        "Another workspace member is editing this chat.",
        409,
        "composer_busy",
      ),
    );

    const response = await post({ action: "acquire", chatId, clientId });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Another workspace member is editing this chat.",
      code: "composer_busy",
    });
  });
});
