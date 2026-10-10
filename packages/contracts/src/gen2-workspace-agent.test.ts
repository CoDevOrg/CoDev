import { describe, expect, it } from "vitest";

import {
  gen2AgentStartRequestSchema,
  gen2ChatMessageSchema,
  gen2PreviewSessionRequestSchema,
  gen2SupersetWorktreeCreateRequestSchema,
  gen2WorkspaceActionSchema,
  gen2WorkspaceContextSchema,
} from "./index";

const id = "11111111-1111-4111-8111-111111111111";

const context = {
  view: { mode: "ide", inspector: "files", terminalOpen: false, narrow: false },
  worktree: {
    id: "main",
    branch: "main",
    changedFiles: 2,
    unsavedEdits: false,
  },
  worktrees: [{ id: "main", branch: "main" }],
  openFile: { path: "src/app.ts", selection: { startLine: 4, endLine: 9 } },
  preview: null,
  listeningPorts: null,
  members: [{ login: "ada", role: "owner" }],
  agents: [],
  excerpts: [],
  previewEnabled: false,
};

describe("gen2 workspace agent contracts", () => {
  it("accepts navigation and proposal actions", () => {
    for (const action of [
      { type: "open_file", path: "src/app.ts", line: 3, endLine: 9 },
      { type: "show_changes" },
      { type: "open_review", path: "apps/web/app/gen2/(home)/page.tsx" },
      { type: "open_terminal" },
      { type: "open_preview", port: 3000, path: "/dashboard?tab=1" },
      { type: "rename_chat", title: "Fix the login flow" },
      { type: "switch_worktree", worktreeId: "feat-x" },
      { type: "open_branch", branch: "feat/x" },
      { type: "create_branch", branch: "feat/y", baseRef: "main" },
      { type: "open_share", emailOrLogin: "ada@example.com" },
      { type: "run_in_terminal", command: "pnpm dev --port 3000" },
      { type: "start_chat", provider: "claude", prompt: "Review this" },
      { type: "open_settings" },
      { type: "update_goal", status: "achieved", summary: "Tests pass." },
    ]) {
      expect(gen2WorkspaceActionSchema.safeParse(action).success).toBe(true);
    }
    expect(
      gen2WorkspaceActionSchema.parse({
        type: "invite_members",
        people: ["ada@example.com"],
      }),
    ).toMatchObject({ role: "editor" });
  });

  it("refuses paths outside the checkout and protected platform paths", () => {
    for (const path of [
      "/etc/passwd",
      "../secrets",
      "src/../../x",
      "a\\b",
      ".codev-runtime/token",
      "lost+found/x",
    ]) {
      expect(
        gen2WorkspaceActionSchema.safeParse({ type: "open_file", path })
          .success,
      ).toBe(false);
    }
  });

  it("refuses multi-line or disguised terminal commands", () => {
    for (const command of [
      "ls\nrm -rf ~",
      "ls\trm",
      "echo \u202eevil",
      "echo hi\u200b",
      "a\u2028b",
    ]) {
      expect(
        gen2WorkspaceActionSchema.safeParse({
          type: "run_in_terminal",
          command,
        }).success,
      ).toBe(false);
    }
  });

  it("keeps preview paths on the previewed origin", () => {
    for (const path of [
      "//evil.example",
      "/\\evil.example",
      "https://x",
      "/a b",
    ])
      expect(
        gen2PreviewSessionRequestSchema.safeParse({ port: 3000, path }).success,
      ).toBe(false);
    expect(gen2PreviewSessionRequestSchema.parse({ port: 3000 })).toEqual({
      port: 3000,
      path: "/",
    });
  });

  it("bounds the workspace snapshot strictly", () => {
    expect(gen2WorkspaceContextSchema.parse(context)).toEqual(context);
    expect(
      gen2WorkspaceContextSchema.safeParse({ ...context, secret: "x" }).success,
    ).toBe(false);
    expect(
      gen2WorkspaceContextSchema.safeParse({
        ...context,
        members: Array.from({ length: 21 }, () => ({
          login: "x",
          role: "editor",
        })),
      }).success,
    ).toBe(false);
  });

  it("accepts any snapshot on the start request, leaving validation to the server", () => {
    const start = {
      chatId: id,
      provider: "codex",
      prompt: "hi",
      idempotencyKey: "turn-1234",
    };
    expect(
      gen2AgentStartRequestSchema.parse({ ...start, workspaceContext: context })
        .workspaceContext,
    ).toEqual(context);
    expect(
      gen2AgentStartRequestSchema.safeParse({
        ...start,
        workspaceContext: { oversized: true },
      }).success,
    ).toBe(true);
  });

  it("stores workspace action items with a chat message", () => {
    const message = gen2ChatMessageSchema.parse({
      id,
      role: "assistant",
      body: "Opened the file.",
      createdAt: "2026-10-09T00:00:00.000Z",
      items: [
        {
          id: "item_1:action:0",
          kind: "workspaceAction",
          status: "completed",
          token: "abc123xyz0",
          action: { type: "open_file", path: "src/app.ts" },
          error: null,
        },
        {
          id: "item_1:action:1",
          kind: "workspaceAction",
          status: "completed",
          token: null,
          action: null,
          error: "Invalid JSON.",
        },
      ],
    });
    expect(message.items).toHaveLength(2);
  });

  it("validates worktree branches with the shared branch rule", () => {
    expect(
      gen2SupersetWorktreeCreateRequestSchema.safeParse({
        worktreeId: "feat-x",
        branch: "feat..x",
      }).success,
    ).toBe(false);
    expect(
      gen2WorkspaceActionSchema.safeParse({
        type: "create_branch",
        branch: "-x",
      }).success,
    ).toBe(false);
  });
});
