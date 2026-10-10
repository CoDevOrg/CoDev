import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { Connection } from "./collaboration-connection";

const mocks = vi.hoisted(() => ({
  snapshot: null as Record<string, unknown> | null,
  write: vi.fn(),
  save: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("../platform/database-operation", () => ({
  withDatabaseOperation: (action: () => unknown) => action(),
}));
vi.mock("../platform/observability", () => ({ logEvent: vi.fn() }));
vi.mock("./collaboration-redis", () => ({
  withDocumentLock: (
    _r: string,
    _t: string,
    _p: string,
    action: () => unknown,
  ) => action(),
}));
vi.mock("./collaboration-rooms", () => ({ publish: mocks.publish }));
vi.mock("./collaboration-documents", () => ({
  loadGen2Document: async () => mocks.snapshot,
  saveGen2Document: mocks.save,
}));
vi.mock("./collaboration-events", () => ({
  gen2CollaborationRoom: () => "room",
}));
vi.mock("./superset", () => ({ saveGen2SupersetFile: mocks.write }));

import { Gen2FileConflictError } from "./errors";
import { flushAutosaves, scheduleAutosave } from "./collaboration-autosave";

function docUpdate(text: string) {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, text);
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
}

const target = { workspaceId: "w", worktreeId: "main", path: "a.ts" };
const connection = () =>
  ({ user: { id: "u1" }, autosaves: new Map() }) as unknown as Connection;

describe("autosave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.snapshot = {
      update: docUpdate("edited"),
      filesystemContents: "original",
      filesystemRevision: "r1",
      revision: "r1",
      hasConflict: false,
    };
  });

  it("writes the shared text with its revision and tells editors it saved", async () => {
    mocks.write.mockResolvedValue({ revision: "r2" });
    const socket = connection();
    scheduleAutosave(socket, target);
    await flushAutosaves(socket);
    expect(mocks.write).toHaveBeenCalledWith("w", "u1", {
      worktreeId: "main",
      path: "a.ts",
      contents: "edited",
      expectedRevision: "r1",
    });
    expect(mocks.publish).toHaveBeenCalledWith(
      "room",
      expect.objectContaining({
        type: "reconciled",
        source: "collaboration",
        revision: "r2",
      }),
    );
  });

  it("does nothing when the file already matches", async () => {
    mocks.snapshot = { ...mocks.snapshot, filesystemContents: "edited" };
    const socket = connection();
    scheduleAutosave(socket, target);
    await flushAutosaves(socket);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("keeps both versions when the file changed underneath", async () => {
    mocks.write.mockRejectedValue(new Gen2FileConflictError("a.ts", "r9"));
    const socket = connection();
    scheduleAutosave(socket, target);
    await flushAutosaves(socket);
    expect(mocks.save).toHaveBeenCalledWith(mocks.snapshot, "r9");
    expect(mocks.publish).toHaveBeenCalledWith(
      "room",
      expect.objectContaining({ type: "conflict", filesystemRevision: "r9" }),
    );
  });

  it("waits for a pause in typing, but not forever", () => {
    vi.useFakeTimers();
    const socket = connection();
    scheduleAutosave(socket, target, 0);
    scheduleAutosave(socket, target, 4_500);
    expect(socket.autosaves.size).toBe(1);
    vi.advanceTimersByTime(600);
    expect(socket.autosaves.size).toBe(0);
    vi.useRealTimers();
  });
});
