import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { Connection } from "./collaboration-connection";

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  stored: "" as string,
  publish: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("../platform/database-operation", () => ({
  withDatabaseOperation: (action: () => unknown) => action(),
}));
vi.mock("../platform/observability", () => ({ logEvent: vi.fn() }));
vi.mock("./collaboration-redis", () => ({
  withDocumentLock: async (
    _room: string,
    _tree: string,
    _path: string,
    action: () => Promise<unknown>,
  ) => {
    mocks.order.push("lock");
    // A slow database: later keystrokes arrive while this one persists.
    await new Promise((resolve) => setTimeout(resolve, 5));
    return action();
  },
}));
vi.mock("./collaboration-rooms", () => ({
  publishStamped: async (_room: string, build: (id: string) => unknown) => {
    mocks.order.push("publish");
    mocks.publish(build("1-0"));
  },
}));
vi.mock("./collaboration-documents", () => ({
  loadGen2Document: async () => ({
    update: mocks.stored,
    hasConflict: false,
    conflictFilesystemRevision: null,
  }),
  saveGen2Document: async (snapshot: { update: string }) => {
    mocks.order.push("save");
    mocks.stored = snapshot.update;
  },
}));
vi.mock("./collaboration-events", () => ({
  gen2CollaborationRoom: () => "room",
}));
vi.mock("./collaboration-autosave", () => ({
  scheduleAutosave: mocks.schedule,
}));

import { applyUpdate } from "./collaboration-update";

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function keystrokes(text: string) {
  const doc = new Y.Doc();
  const updates: string[] = [];
  doc.on("update", (update: Uint8Array) => updates.push(b64(update)));
  for (const char of text)
    doc.getText("content").insert(doc.getText("content").length, char);
  return updates;
}

const connection = () =>
  ({
    worktreeId: "main",
    user: { id: "u1" },
    pendingUpdates: new Map(),
    socket: { readyState: 1, openState: 1, send: vi.fn() },
  }) as unknown as Connection;

describe("applyUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order = [];
    mocks.stored = b64(Y.encodeStateAsUpdate(new Y.Doc()));
  });

  it("sends each keystroke to members before it is persisted", async () => {
    await applyUpdate("w", connection(), "a.ts", keystrokes("h")[0]!);
    expect(mocks.order).toEqual(["publish", "lock", "save"]);
  });

  it("keeps every keystroke typed faster than the database", async () => {
    const socket = connection();
    await Promise.all(
      keystrokes("hello").map((update) =>
        applyUpdate("w", socket, "a.ts", update),
      ),
    );
    expect(mocks.publish).toHaveBeenCalledTimes(5);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Buffer.from(mocks.stored, "base64"));
    expect(doc.getText("content").toString()).toBe("hello");
    expect(socket.pendingUpdates.size).toBe(0);
    expect(mocks.schedule).toHaveBeenCalled();
  });
});
