import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  loadSharedSessionSnapshot: vi.fn(),
  enqueueSharedSessionInstruction: vi.fn(),
  startControlledSharedSessionTurn: vi.fn(),
  interruptSharedSession: vi.fn(),
  selectSharedSessionProvider: vi.fn(),
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
vi.mock("@/lib/shared-session-server", () => ({
  SharedSessionError: class SharedSessionError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
  loadSharedSessionSnapshot: mocks.loadSharedSessionSnapshot,
  enqueueSharedSessionInstruction: mocks.enqueueSharedSessionInstruction,
  startControlledSharedSessionTurn: mocks.startControlledSharedSessionTurn,
  interruptSharedSession: mocks.interruptSharedSession,
  selectSharedSessionProvider: mocks.selectSharedSessionProvider,
}));

import { GET as getShared } from "@/app/api/workspaces/[workspaceId]/agents/shared/route";
import { POST as enqueue } from "@/app/api/workspaces/[workspaceId]/agents/[sessionId]/queue/route";
import { POST as startControlled } from "@/app/api/workspaces/[workspaceId]/agents/[sessionId]/controlled/route";
import { POST as interrupt } from "@/app/api/workspaces/[workspaceId]/agents/[sessionId]/interrupt/route";
import { POST as selectProvider } from "@/app/api/workspaces/[workspaceId]/agents/[sessionId]/provider/route";
import { SharedSessionError } from "@/lib/shared-session-server";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const sessionId = "f3100000-0000-4000-8000-000000000001";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const snapshot = {
  viewer: { id: userId, name: "Jordan Lee", canCoSteer: true },
  sharedSessions: [
    {
      session: {
        sessionId,
        state: "running",
        queue: [
          {
            authorId: userId,
            prompt: "Inspect README.md",
            queuePosition: 1,
          },
        ],
      },
      lastCompletedAction: {
        tool: "read_file · README.md",
        output: "Repository structure is ready for the shared session.",
      },
    },
  ],
};

describe("shared agent session routes", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId, name: "Jordan Lee" });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.loadSharedSessionSnapshot.mockResolvedValue(snapshot);
    mocks.enqueueSharedSessionInstruction.mockResolvedValue(snapshot);
    mocks.startControlledSharedSessionTurn.mockResolvedValue(snapshot);
    mocks.interruptSharedSession.mockResolvedValue({
      ...snapshot,
      sharedSessions: [
        {
          ...snapshot.sharedSessions[0],
          session: {
            ...snapshot.sharedSessions[0]!.session,
            state: "interrupted",
          },
        },
      ],
    });
    mocks.selectSharedSessionProvider.mockResolvedValue({
      ...snapshot,
      sharedSessions: [
        {
          ...snapshot.sharedSessions[0],
          session: {
            ...snapshot.sharedSessions[0]!.session,
            state: "idle",
            provider: "restricted",
          },
          capabilities: {
            id: "restricted",
            canQueue: false,
            canInterrupt: false,
            queueUnavailable:
              "This restricted fixture provider does not support queued instructions.",
          },
        },
      ],
    });
  });

  afterEach(() => vi.resetAllMocks());

  it("returns the durable shared session snapshot after authorization", async () => {
    const response = await getShared(new Request("https://codev.test"), {
      params: Promise.resolve({ workspaceId }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      viewer: { name: "Jordan Lee", canCoSteer: true },
      sharedSessions: [
        {
          session: { sessionId, queue: [{ prompt: "Inspect README.md" }] },
        },
      ],
    });
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "view",
    );
  });

  it("queues an attributed instruction without starting a provider turn", async () => {
    const response = await enqueue(
      new Request("https://codev.test", {
        method: "POST",
        body: JSON.stringify({ prompt: "Inspect README.md" }),
      }),
      { params: Promise.resolve({ workspaceId, sessionId }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sharedSessions: [
        {
          session: {
            queue: [{ authorId: userId, prompt: "Inspect README.md" }],
          },
        },
      ],
    });
    expect(mocks.enqueueSharedSessionInstruction).toHaveBeenCalledWith(
      workspaceId,
      sessionId,
      expect.objectContaining({ id: userId }),
      "Inspect README.md",
    );
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "coSteer",
    );
  });

  it("blocks a queued instruction after the provider connection is revoked", async () => {
    mocks.enqueueSharedSessionInstruction.mockRejectedValueOnce(
      new SharedSessionError(
        "This OpenAI connection was revoked or is not connected. Reconnect a key in Settings before starting another turn. The existing session is unchanged.",
        409,
      ),
    );
    const response = await enqueue(
      new Request("https://codev.test", {
        method: "POST",
        body: JSON.stringify({ prompt: "Inspect README.md" }),
      }),
      { params: Promise.resolve({ workspaceId, sessionId }) },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "This OpenAI connection was revoked or is not connected. Reconnect a key in Settings before starting another turn. The existing session is unchanged.",
    });
  });

  it("starts a controlled turn and interrupts it while preserving the last action", async () => {
    const started = await startControlled(new Request("https://codev.test"), {
      params: Promise.resolve({ workspaceId, sessionId }),
    });
    expect(started.status).toBe(200);
    expect(mocks.startControlledSharedSessionTurn).toHaveBeenCalledWith(
      workspaceId,
      sessionId,
      expect.objectContaining({ id: userId }),
    );

    const cancelled = await interrupt(new Request("https://codev.test"), {
      params: Promise.resolve({ workspaceId, sessionId }),
    });
    expect(cancelled.status).toBe(200);
    await expect(cancelled.json()).resolves.toMatchObject({
      sharedSessions: [
        {
          session: { state: "interrupted" },
          lastCompletedAction: {
            tool: "read_file · README.md",
          },
        },
      ],
    });
  });

  it("selects the restricted fixture provider and returns disabled-control flags", async () => {
    const response = await selectProvider(
      new Request("https://codev.test", {
        method: "POST",
        body: JSON.stringify({ provider: "restricted" }),
      }),
      { params: Promise.resolve({ workspaceId, sessionId }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sharedSessions: [
        {
          session: { provider: "restricted" },
          capabilities: { canQueue: false, canInterrupt: false },
        },
      ],
    });
    expect(mocks.selectSharedSessionProvider).toHaveBeenCalledWith(
      workspaceId,
      sessionId,
      expect.objectContaining({ id: userId }),
      "restricted",
    );
  });

  it("rejects queueing when the restricted fixture provider lacks that capability", async () => {
    mocks.enqueueSharedSessionInstruction.mockRejectedValueOnce(
      new SharedSessionError(
        "This restricted fixture provider does not support queued instructions.",
        409,
      ),
    );
    const response = await enqueue(
      new Request("https://codev.test", {
        method: "POST",
        body: JSON.stringify({ prompt: "Inspect README.md" }),
      }),
      { params: Promise.resolve({ workspaceId, sessionId }) },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "This restricted fixture provider does not support queued instructions.",
    });
  });
});
