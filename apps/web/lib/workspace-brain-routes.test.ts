import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  getAgentBrief: vi.fn(),
  updateAgentBrief: vi.fn(),
  listWorkspaceBriefs: vi.fn(),
  listWorkspaceOverlaps: vi.fn(),
  listBrainEntries: vi.fn(),
  recordBrainEntry: vi.fn(),
  updateOverlapStatus: vi.fn(),
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
vi.mock("@/lib/workspace-brain", () => ({
  getAgentBrief: mocks.getAgentBrief,
  updateAgentBrief: mocks.updateAgentBrief,
  listWorkspaceBriefs: mocks.listWorkspaceBriefs,
  listWorkspaceOverlaps: mocks.listWorkspaceOverlaps,
  listBrainEntries: mocks.listBrainEntries,
  recordBrainEntry: mocks.recordBrainEntry,
  updateOverlapStatus: mocks.updateOverlapStatus,
}));

import {
  GET as getBrief,
  PUT as putBrief,
} from "@/app/api/workspaces/[workspaceId]/agents/[sessionId]/brief/route";
import { GET as getBrain } from "@/app/api/workspaces/[workspaceId]/agents/brain/route";
import {
  GET as getEntries,
  POST as postEntry,
} from "@/app/api/workspaces/[workspaceId]/agents/brain/entries/route";
import { PATCH as patchOverlap } from "@/app/api/workspaces/[workspaceId]/agents/brain/overlaps/[overlapId]/route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const sessionId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const overlapId = "3a1187ed-4a63-4b05-88cc-266d65f7b999";
const userId = "9c2287ed-4a63-4b05-88cc-266d65f7b111";

function request(body?: unknown, search = "") {
  return new Request(`https://codev.test/x${search}`, {
    method: body ? "POST" : "GET",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("workspace brain routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiUser.mockResolvedValue({ id: userId, name: "Jordan Lee" });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
  });

  it("returns a session brief", async () => {
    mocks.getAgentBrief.mockResolvedValue({
      sessionId,
      goal: "Ship the thing",
    });
    const response = await getBrief(request(), {
      params: Promise.resolve({ workspaceId, sessionId }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      brief: { sessionId, goal: "Ship the thing" },
    });
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "view",
    );
  });

  it("requires co-steer to write a brief", async () => {
    mocks.requireWorkspacePermission.mockRejectedValueOnce(
      Object.assign(new Error("forbidden"), { status: 403 }),
    );
    const response = await putBrief(request({ currentStep: "editing" }), {
      params: Promise.resolve({ workspaceId, sessionId }),
    });
    expect(response.status).toBe(403);
    expect(mocks.updateAgentBrief).not.toHaveBeenCalled();
  });

  it("persists a brief update", async () => {
    mocks.updateAgentBrief.mockResolvedValue({
      sessionId,
      currentStep: "tests",
    });
    const response = await putBrief(request({ currentStep: "tests" }), {
      params: Promise.resolve({ workspaceId, sessionId }),
    });
    expect(response.status).toBe(200);
    expect(mocks.updateAgentBrief).toHaveBeenCalledWith(
      workspaceId,
      sessionId,
      {
        currentStep: "tests",
      },
    );
  });

  it("assembles the mission-control snapshot", async () => {
    mocks.listWorkspaceBriefs.mockResolvedValue([{ sessionId }]);
    mocks.listWorkspaceOverlaps.mockResolvedValue([{ id: overlapId }]);
    mocks.listBrainEntries.mockResolvedValue([{ id: "entry-1" }]);
    const response = await getBrain(request(), {
      params: Promise.resolve({ workspaceId }),
    });
    expect(await response.json()).toEqual({
      briefs: [{ sessionId }],
      overlaps: [{ id: overlapId }],
      entries: [{ id: "entry-1" }],
    });
  });

  it("records a brain entry with the caller as author", async () => {
    mocks.recordBrainEntry.mockResolvedValue({
      id: "entry-9",
      kind: "dead_end",
    });
    const response = await postEntry(
      request({ kind: "dead_end", title: "Tried the cache, made it worse" }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(201);
    expect(mocks.recordBrainEntry).toHaveBeenCalledWith(
      workspaceId,
      null,
      userId,
      expect.objectContaining({ kind: "dead_end" }),
    );
  });

  it("passes a search query through to the entry list", async () => {
    mocks.listBrainEntries.mockResolvedValue([]);
    await getEntries(request(undefined, "?q=login%20redirect"), {
      params: Promise.resolve({ workspaceId }),
    });
    expect(mocks.listBrainEntries).toHaveBeenCalledWith(
      workspaceId,
      expect.objectContaining({ query: "login redirect" }),
    );
  });

  it("updates an overlap status", async () => {
    mocks.updateOverlapStatus.mockResolvedValue({
      id: overlapId,
      status: "acknowledged",
    });
    const response = await patchOverlap(
      new Request("https://codev.test/x", {
        method: "PATCH",
        body: JSON.stringify({ status: "acknowledged" }),
      }),
      { params: Promise.resolve({ workspaceId, overlapId }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.updateOverlapStatus).toHaveBeenCalledWith(
      workspaceId,
      overlapId,
      "acknowledged",
    );
  });
});
