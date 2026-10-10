import { describe, expect, it } from "vitest";

import type { SlashContext } from "./chat-slash-commands";
import { parseWorkspaceCommand } from "./chat-workspace-commands";

const context: SlashContext = {
  workspace: true,
  canEdit: true,
  previewEnabled: false,
  hasGoal: false,
  currentWorktreeId: "main",
  worktrees: [
    { id: "main", branch: "main" },
    { id: "feat-login", branch: "feat/login" },
  ],
  remoteBranches: ["main", "feat/login", "feat/remote"],
  remoteError: null,
  repositoryPrivate: false,
  files: [{ path: "src/app.ts", kind: "file", size: 1 }],
  knownPort: null,
};

describe("parseWorkspaceCommand", () => {
  it("runs commands without an argument", () => {
    expect(parseWorkspaceCommand(" /changes ", context)).toEqual({
      type: "run",
      action: { type: "show_changes" },
    });
    expect(parseWorkspaceCommand("/new", context)).toEqual({
      type: "workspace",
      command: "new",
    });
  });

  it("leaves agent commands, prose and unknown commands to the agent", () => {
    expect(parseWorkspaceCommand("/goal clear", context)).toBeNull();
    expect(parseWorkspaceCommand("/plan the login", context)).toBeNull();
    expect(
      parseWorkspaceCommand("/changes please explain them", context),
    ).toBeNull();
    expect(parseWorkspaceCommand("/deploy", context)).toBeNull();
    expect(parseWorkspaceCommand("/changes\nand more", context)).toBeNull();
    expect(
      parseWorkspaceCommand("/changes", { ...context, workspace: false }),
    ).toBeNull();
  });

  it("matches /branch exactly: switch, open, create or explain", () => {
    expect(parseWorkspaceCommand("/branch feat/login", context)).toEqual({
      type: "run",
      action: { type: "switch_worktree", worktreeId: "feat-login" },
    });
    expect(parseWorkspaceCommand("/branch feat/remote", context)).toEqual({
      type: "run",
      action: { type: "open_branch", branch: "feat/remote" },
    });
    expect(parseWorkspaceCommand("/branch feat", context)).toEqual({
      type: "run",
      action: { type: "create_branch", branch: "feat" },
    });
    expect(parseWorkspaceCommand("/branch main", context)).toMatchObject({
      type: "notice",
    });
    expect(parseWorkspaceCommand("/branch a..b", context)).toMatchObject({
      type: "notice",
    });
  });

  it("agrees with the /branch menu's first row while GitHub is unknown", () => {
    const loading = { ...context, remoteBranches: null };
    expect(parseWorkspaceCommand("/branch feat/remote", loading)).toEqual({
      type: "notice",
      message: "Still loading branches from GitHub. Try again in a moment.",
    });
    expect(
      parseWorkspaceCommand("/branch feat", {
        ...loading,
        remoteError: "GitHub took too long to answer.",
      }),
    ).toEqual({ type: "notice", message: "GitHub took too long to answer." });
    expect(
      parseWorkspaceCommand("/branch feat/remote", {
        ...context,
        repositoryPrivate: true,
      }),
    ).toMatchObject({ type: "notice" });
  });

  it("explains a command whose argument is missing or invalid", () => {
    expect(parseWorkspaceCommand("/open", context)).toEqual({
      type: "notice",
      message: "Name a file to open, like /open src/app.ts.",
    });
    expect(parseWorkspaceCommand("/open /etc/passwd", context)).toMatchObject({
      type: "notice",
    });
    expect(parseWorkspaceCommand("/rename", context)).toMatchObject({
      type: "notice",
    });
  });

  it("passes the argument of /share, /rename and /preview", () => {
    expect(parseWorkspaceCommand("/share ada@example.com", context)).toEqual({
      type: "run",
      action: { type: "open_share", emailOrLogin: "ada@example.com" },
    });
    expect(parseWorkspaceCommand("/share", context)).toEqual({
      type: "run",
      action: { type: "open_share" },
    });
    expect(parseWorkspaceCommand("/rename Login flow", context)).toEqual({
      type: "run",
      action: { type: "rename_chat", title: "Login flow" },
    });
    const preview = { ...context, previewEnabled: true };
    expect(parseWorkspaceCommand("/preview 5173", preview)).toEqual({
      type: "run",
      action: { type: "open_preview", port: 5173 },
    });
    expect(parseWorkspaceCommand("/preview", preview)).toMatchObject({
      type: "notice",
    });
    expect(parseWorkspaceCommand("/preview 99999", preview)).toMatchObject({
      type: "notice",
    });
  });
});
