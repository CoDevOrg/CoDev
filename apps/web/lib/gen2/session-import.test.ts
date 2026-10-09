import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  drafts: [] as unknown[],
  inserts: [] as { table: unknown; values: unknown }[],
  updates: [] as unknown[],
  failInsert: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("./workspaces", () => ({
  requireGen2Member: (...args: unknown[]) => mocks.member(...args),
}));
vi.mock("../platform/kms", () => ({
  encryptSecret: async (value: string) => `enc:${value}`,
  decryptSecret: async (value: string) => value.replace(/^enc:/, ""),
}));
vi.mock("../platform/database", () => {
  // Every query builder call returns the chain; awaiting it yields `result`.
  const chain = (result: () => unknown) => {
    const target: Record<string, unknown> = {};
    const proxy: unknown = new Proxy(target, {
      get: (_, key) =>
        key === "then"
          ? (resolve: (value: unknown) => void) => resolve(result())
          : () => proxy,
    });
    return proxy;
  };
  const database = {
    select: () => chain(() => mocks.drafts),
    delete: () => chain(() => undefined),
    update: () => ({
      set: (values: unknown) => {
        mocks.updates.push(values);
        return chain(() => undefined);
      },
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        if (mocks.failInsert && Array.isArray(values)) {
          throw new Error("insert failed");
        }
        mocks.inserts.push({ table, values });
        return chain(() => [{ id: "33333333-3333-4333-8333-333333333333" }]);
      },
    }),
    transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run(database),
  };
  return { getDatabase: () => database };
});

import { schema } from "@codev/db";

import {
  confirmGen2SessionImport,
  previewGen2SessionImport,
} from "./session-import";

const SESSION = "ed1d5840-87cc-4300-a4da-2733bbe91003";
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const IMPORT = "22222222-2222-4222-8222-222222222222";
const transcript = [
  {
    type: "user",
    sessionId: SESSION,
    uuid: "u1",
    parentUuid: null,
    timestamp: "2026-10-08T10:00:00.000Z",
    message: { content: "Same time" },
  },
  {
    type: "assistant",
    sessionId: SESSION,
    uuid: "a1",
    parentUuid: "u1",
    timestamp: "2026-10-08T10:00:00.000Z",
    message: { id: "m1", content: [{ type: "text", text: "Reply" }] },
  },
]
  .map((line) => JSON.stringify(line))
  .join("\n");

describe("session import storage", () => {
  beforeEach(() => {
    mocks.member.mockReset().mockResolvedValue({ role: "editor" });
    mocks.drafts = [];
    mocks.inserts = [];
    mocks.updates = [];
    mocks.failInsert = false;
  });

  it("rejects viewers before reading the upload", async () => {
    mocks.member.mockResolvedValue({ role: "viewer" });
    await expect(
      previewGen2SessionImport({
        workspaceId: WORKSPACE,
        userId: "viewer",
        provider: "claude",
        bytes: new Uint8Array(),
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.inserts).toEqual([]);
  });

  it("saves an encrypted draft and returns its preview", async () => {
    const preview = await previewGen2SessionImport({
      workspaceId: WORKSPACE,
      userId: "editor",
      provider: "claude",
      bytes: new TextEncoder().encode(transcript),
    });
    expect(preview).toMatchObject({ provider: "claude", messageCount: 2 });
    const [draft] = mocks.inserts;
    expect(draft?.table).toBe(schema.gen2SessionImports);
    expect(draft?.values).toMatchObject({
      id: preview.importId,
      importedByUserId: "editor",
      nativeSessionId: SESSION,
      encryptedPayload: expect.stringMatching(/^enc:/),
    });
  });

  it("only confirms the importer's own draft", async () => {
    await expect(
      confirmGen2SessionImport({
        workspaceId: WORKSPACE,
        userId: "other",
        importId: IMPORT,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      confirmGen2SessionImport({
        workspaceId: WORKSPACE,
        userId: "other",
        importId: "../x",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("creates the chat with strictly increasing message times", async () => {
    const preview = await previewGen2SessionImport({
      workspaceId: WORKSPACE,
      userId: "editor",
      provider: "claude",
      bytes: new TextEncoder().encode(transcript),
    });
    const draft = mocks.inserts[0]!.values as Record<string, unknown>;
    mocks.drafts = [{ ...draft, id: preview.importId, provider: "claude" }];
    mocks.inserts = [];

    await expect(
      confirmGen2SessionImport({
        workspaceId: WORKSPACE,
        userId: "editor",
        importId: preview.importId,
        title: "Imported",
      }),
    ).resolves.toEqual({ chatId: "33333333-3333-4333-8333-333333333333" });

    const [chat, messages] = mocks.inserts;
    expect(chat?.values).toMatchObject({
      title: "Imported",
      provider: "claude",
    });
    const rows = messages?.values as { createdAt: Date; body: string }[];
    expect(rows.map((row) => row.body)).toEqual(["Same time", "Reply"]);
    expect(rows[1]!.createdAt.getTime()).toBe(rows[0]!.createdAt.getTime() + 1);
    expect(mocks.updates).toContainEqual(
      expect.objectContaining({ status: "imported" }),
    );
  });

  it("does not mark the draft imported when saving messages fails", async () => {
    const preview = await previewGen2SessionImport({
      workspaceId: WORKSPACE,
      userId: "editor",
      provider: "claude",
      bytes: new TextEncoder().encode(transcript),
    });
    const draft = mocks.inserts[0]!.values as Record<string, unknown>;
    mocks.drafts = [{ ...draft, id: preview.importId, provider: "claude" }];
    mocks.failInsert = true;
    await expect(
      confirmGen2SessionImport({
        workspaceId: WORKSPACE,
        userId: "editor",
        importId: preview.importId,
      }),
    ).rejects.toThrow("insert failed");
    expect(mocks.updates).toEqual([]);
  });
});
