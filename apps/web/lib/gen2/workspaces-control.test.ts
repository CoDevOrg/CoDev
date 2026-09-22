import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const editorId = "33333333-3333-4333-8333-333333333333";
const chatId = "44444444-4444-4444-8444-444444444444";
const editorCapabilities = {
  "workspace.view": true,
  "workspace.editFiles": true,
  "workspace.useTerminal": true,
  "agent.run": true,
  "agent.cancelOwn": true,
  "agent.cancelAny": false,
  "context.view": true,
  "context.includeInTurn": true,
  "member.invite": false,
  "member.changeRole": false,
  "member.remove": false,
  "workspace.managePolicy": false,
  "connection.manageOwn": true,
  "connection.viewStatus": true,
};

const mocks = vi.hoisted(() => ({
  rows: [] as Array<unknown>,
  selectResults: [] as Array<Array<Record<string, unknown>>>,
  updates: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
  deleted: false,
  requirePermission: vi.fn(),
  providerReadiness: vi.fn(),
  createToken: vi.fn(),
  hashToken: vi.fn((token: string) => `hash:${token}`),
  chat: vi.fn(),
  messages: vi.fn(),
}));

function selectedRows() {
  const rows = mocks.selectResults.shift() ?? [];
  Object.assign(rows, { limit: async () => rows });
  return rows;
}

vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => selectedRows(),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.updates.push(values);
        return {
          where: () => ({
            returning: async () => [{ userId: editorId, role: values.role }],
          }),
        };
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        mocks.inserts.push(values);
        return { onConflictDoNothing: async () => undefined };
      },
    }),
    delete: () => ({
      where: async () => {
        mocks.deleted = true;
      },
    }),
  }),
}));

vi.mock("../policies/workspace", () => ({
  requireWorkspacePermission: (...args: unknown[]) =>
    mocks.requirePermission(...args),
}));

vi.mock("../platform/crypto", () => ({
  createInviteToken: () => mocks.createToken(),
  hashInviteToken: (token: string) => mocks.hashToken(token),
}));

vi.mock("./provider-adapters", () => ({
  listGen2ProviderReadiness: (...args: unknown[]) =>
    mocks.providerReadiness(...args),
}));

vi.mock("./chats", () => ({
  requireGen2Chat: (...args: unknown[]) => mocks.chat(...args),
  listGen2ChatMessages: (...args: unknown[]) => mocks.messages(...args),
}));

vi.mock("../platform/observability", () => ({ logEvent: vi.fn() }));

import {
  changeGen2MemberRole,
  createGen2ShareLink,
  getGen2ContextPreview,
  getGen2MemberConnectionStatuses,
  joinGen2Workspace,
  removeGen2Member,
  revokeGen2ShareLink,
} from "./workspaces";

describe("Gen 2 control backend", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T12:00:00.000Z"));
    vi.resetAllMocks();
    mocks.selectResults.length = 0;
    mocks.updates.length = 0;
    mocks.inserts.length = 0;
    mocks.deleted = false;
    mocks.createToken
      .mockReturnValueOnce("first")
      .mockReturnValueOnce("second");
    mocks.requirePermission.mockResolvedValue({
      role: "owner",
      capabilities: { "member.invite": true },
    });
    mocks.providerReadiness.mockResolvedValue([]);
  });

  it("rotates one editor invite and clears every field on revocation", async () => {
    await createGen2ShareLink(workspaceId, ownerId, "https://codev.test");
    await createGen2ShareLink(workspaceId, ownerId, "https://codev.test");
    await revokeGen2ShareLink(workspaceId, ownerId);

    expect(mocks.updates[0]).toMatchObject({
      activeInviteTokenHash: "hash:first",
      activeInviteCreatedByUserId: ownerId,
      activeInviteRole: "editor",
      activeInviteExpiresAt: new Date("2026-09-29T12:00:00.000Z"),
    });
    expect(mocks.updates[1]).toMatchObject({
      activeInviteTokenHash: "hash:second",
    });
    expect(mocks.updates[2]).toMatchObject({
      activeInviteTokenHash: null,
      activeInviteCreatedByUserId: null,
      activeInviteRole: null,
      activeInviteCreatedAt: null,
      activeInviteExpiresAt: null,
    });
  });

  it("rejects expired invites and grants editors through valid ones", async () => {
    mocks.selectResults.push([
      {
        id: workspaceId,
        activeInviteExpiresAt: new Date("2026-09-22T11:59:59.000Z"),
      },
    ]);
    await expect(joinGen2Workspace("expired", editorId)).rejects.toMatchObject({
      status: 404,
    });

    mocks.selectResults.push(
      [
        {
          id: workspaceId,
          activeInviteExpiresAt: new Date("2026-09-29T12:00:00.000Z"),
        },
      ],
      [
        {
          id: workspaceId,
          name: "Workspace",
          status: "ready",
          sandboxId: null,
          lastError: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    );
    mocks.requirePermission.mockResolvedValueOnce({
      role: "editor",
      capabilities: editorCapabilities,
    });
    await joinGen2Workspace("valid", editorId);
    expect(mocks.inserts.at(-1)).toMatchObject({
      workspaceId,
      userId: editorId,
      role: "editor",
    });
  });

  it("allows editor/viewer mutations but protects and distinguishes owners", async () => {
    mocks.selectResults.push([{ role: "editor" }]);
    await expect(
      changeGen2MemberRole({
        workspaceId,
        userId: ownerId,
        targetUserId: editorId,
        role: "viewer",
      }),
    ).resolves.toMatchObject({ role: "viewer" });

    mocks.selectResults.push([{ role: "viewer" }]);
    await expect(
      changeGen2MemberRole({
        workspaceId,
        userId: ownerId,
        targetUserId: editorId,
        role: "editor",
      }),
    ).resolves.toMatchObject({ role: "editor" });

    mocks.selectResults.push([{ role: "owner" }]);
    await expect(
      changeGen2MemberRole({
        workspaceId,
        userId: ownerId,
        targetUserId: ownerId,
        role: "viewer",
      }),
    ).rejects.toMatchObject({ status: 409 });

    mocks.selectResults.push([{ role: "editor" }]);
    await expect(
      removeGen2Member({
        workspaceId,
        userId: ownerId,
        targetUserId: editorId,
      }),
    ).resolves.toBeUndefined();
    expect(mocks.deleted).toBe(true);

    mocks.selectResults.push([{ role: "owner" }]);
    await expect(
      removeGen2Member({ workspaceId, userId: ownerId, targetUserId: ownerId }),
    ).rejects.toMatchObject({ status: 409 });

    mocks.selectResults.push([]);
    await expect(
      removeGen2Member({
        workspaceId,
        userId: ownerId,
        targetUserId: editorId,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("returns only redacted provider readiness and an exact context selection", async () => {
    mocks.selectResults.push([{ userId: ownerId }, { userId: editorId }]);
    mocks.providerReadiness
      .mockResolvedValueOnce([
        { id: "openai", label: "OpenAI", installed: true, ready: true },
      ])
      .mockResolvedValueOnce([
        { id: "openai", label: "OpenAI", installed: true, ready: false },
      ]);
    await expect(
      getGen2MemberConnectionStatuses(workspaceId, ownerId),
    ).resolves.toEqual([
      {
        userId: ownerId,
        providers: [
          { id: "openai", label: "OpenAI", installed: true, ready: true },
        ],
      },
      {
        userId: editorId,
        providers: [
          { id: "openai", label: "OpenAI", installed: true, ready: false },
        ],
      },
    ]);

    mocks.chat.mockResolvedValue({ id: chatId });
    mocks.messages.mockResolvedValue([
      {
        id: "55555555-5555-4555-8555-555555555555",
        role: "user",
        body: "hello",
      },
    ]);
    await expect(
      getGen2ContextPreview({ workspaceId, chatId, userId: ownerId }),
    ).resolves.toEqual({
      chatId,
      messageIds: ["55555555-5555-4555-8555-555555555555"],
      messageCount: 1,
      maxMessages: 20,
      maxCharacters: 12_000,
    });
  });

  it("keeps connection visibility capability-gated", async () => {
    mocks.requirePermission.mockRejectedValueOnce(
      Object.assign(new Error("forbidden"), { status: 403 }),
    );
    await expect(
      getGen2MemberConnectionStatuses(workspaceId, editorId),
    ).rejects.toMatchObject({ status: 403 });
  });
});
