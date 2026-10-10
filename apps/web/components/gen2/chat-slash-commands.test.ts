import { describe, expect, it } from "vitest";

import {
  buildSlashItems,
  parseWorkspaceCommand,
  type SlashContext,
} from "./chat-slash-commands";
import type { ComposerTrigger } from "./use-composer-typeahead";

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
  files: [
    { path: "src/app.ts", kind: "file", size: 1 },
    { path: "src", kind: "directory" },
  ],
  knownPort: null,
};

function slash(query: string, command: string | null = null): ComposerTrigger {
  return { kind: "slash", start: 0, end: query.length + 1, query, command };
}

const labels = (items: ReturnType<typeof buildSlashItems>) =>
  items.map((item) => item.label);

describe("buildSlashItems", () => {
  it("lists agent modes, then workspace commands, filtered by prefix", () => {
    const items = buildSlashItems(slash(""), context);
    expect(items[0]).toMatchObject({
      group: "Agent",
      label: "/plan",
      action: { type: "insert", text: "/plan " },
    });
    expect(labels(items)).toContain("/changes");
    expect(labels(buildSlashItems(slash("re"), context))).toEqual([
      "/review",
      "/rename",
    ]);
  });

  it("offers goal controls only while the chat has a goal", () => {
    expect(labels(buildSlashItems(slash("goal"), context))).toEqual(["/goal"]);
    const items = buildSlashItems(slash("go"), { ...context, hasGoal: true });
    expect(labels(items)).toEqual(["/goal", "/goal done", "/goal clear"]);
    expect(items[1]!.action).toEqual({ type: "send", prompt: "/goal done" });
  });

  it("hides workspace commands outside the shell, and editor ones from viewers", () => {
    expect(
      labels(buildSlashItems(slash(""), { ...context, workspace: false })),
    ).toEqual(["/plan", "/ask", "/goal", "/review", "/init"]);
    const viewer = labels(
      buildSlashItems(slash(""), { ...context, canEdit: false }),
    );
    expect(viewer).toEqual([
      "/open",
      "/changes",
      "/diff",
      "/board",
      "/settings",
    ]);
  });

  it("shows /preview only when previews are enabled", () => {
    expect(labels(buildSlashItems(slash("pre"), context))).toEqual([]);
    const items = buildSlashItems(slash("pre"), {
      ...context,
      previewEnabled: true,
      knownPort: 3000,
    });
    expect(items[0]!.action).toEqual({
      type: "run",
      action: { type: "open_preview", port: 3000 },
    });
  });

  it("lists other worktrees, unopened GitHub branches, then a new branch", () => {
    const items = buildSlashItems(slash("feat", "branch"), context);
    expect(labels(items)).toEqual([
      "Switch to feat/login",
      "Open feat/remote",
      "Create branch feat",
    ]);
    expect(items[0]!.action).toEqual({
      type: "run",
      action: { type: "switch_worktree", worktreeId: "feat-login" },
    });
  });

  it("puts an exact branch first and never offers to create one that exists", () => {
    const items = buildSlashItems(slash("feat/remote", "branch"), context);
    expect(labels(items)).toEqual(["Open feat/remote"]);
    expect(
      labels(buildSlashItems(slash("bad..name", "branch"), context)),
    ).toEqual([]);
  });

  it("opens files by path, falling back to the typed path when unlisted", () => {
    expect(buildSlashItems(slash("app", "open"), context)[0]!.action).toEqual({
      type: "run",
      action: { type: "open_file", path: "src/app.ts" },
    });
    expect(
      labels(
        buildSlashItems(slash("docs/a.md", "open"), {
          ...context,
          files: null,
        }),
      ),
    ).toEqual(["Open docs/a.md"]);
    expect(
      buildSlashItems(slash("../etc", "open"), { ...context, files: null }),
    ).toEqual([]);
  });
});

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
