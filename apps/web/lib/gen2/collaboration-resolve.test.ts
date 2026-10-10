import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { Connection } from "./collaboration-connection";

const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  save: vi.fn(),
  publish: vi.fn(),
  snapshot: null as Record<string, unknown> | null,
}));
vi.mock("./workspaces", () => ({ requireGen2Member: mocks.member }));
vi.mock("./superset", () => ({
  readGen2SupersetFile: mocks.read,
  saveGen2SupersetFile: mocks.write,
}));
vi.mock("./collaboration-documents", () => ({
  loadGen2Document: async () => mocks.snapshot,
  saveGen2Document: mocks.save,
}));
vi.mock("./collaboration-rooms", () => ({ publish: mocks.publish }));
vi.mock("./collaboration-events", () => ({
  gen2CollaborationRoom: () => "room",
}));
vi.mock("./collaboration-redis", () => ({
  withDocumentLock: (
    _r: string,
    _t: string,
    _p: string,
    action: () => unknown,
  ) => action(),
}));

import { resolveConflict } from "./collaboration-resolve";

const USER = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const send = vi.fn();
const connection = {
  worktreeId: "main",
  user: { id: USER },
  socket: { readyState: 1, openState: 1, send },
} as unknown as Connection;

function encoded(text: string) {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, text);
  return {
    update: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"),
    stateVector: Buffer.from(Y.encodeStateVector(doc)).toString("base64"),
  };
}

describe("resolveConflict", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.member.mockResolvedValue({ role: "editor" });
    mocks.snapshot = { ...encoded("editor text"), hasConflict: true };
    mocks.read.mockResolvedValue({ contents: "agent text", revision: "r9" });
  });

  it("keeps the editor's text by writing it over the current file", async () => {
    mocks.write.mockResolvedValue({ revision: "r10" });
    await resolveConflict("w", connection, "a.ts", "editor");
    expect(mocks.write).toHaveBeenCalledWith("w", USER, {
      workspaceId: "w",
      worktreeId: "main",
      path: "a.ts",
      contents: "editor text",
      expectedRevision: "r9",
    });
    expect(mocks.publish).toHaveBeenCalledWith(
      "room",
      expect.objectContaining({ type: "reconciled", revision: "r10" }),
    );
  });

  it("takes the workspace file into the shared text", async () => {
    await resolveConflict("w", connection, "a.ts", "workspace");
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        filesystemContents: "agent text",
        revision: "r9",
      }),
    );
    expect(mocks.publish.mock.calls[0]![1].update).toEqual(expect.any(String));
  });

  it("refuses viewers", async () => {
    mocks.member.mockResolvedValue({ role: "viewer" });
    await resolveConflict("w", connection, "a.ts", "editor");
    expect(mocks.write).not.toHaveBeenCalled();
    expect(JSON.parse(send.mock.calls[0]![0])).toMatchObject({
      code: "forbidden",
    });
  });
});
