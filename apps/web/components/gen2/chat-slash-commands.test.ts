import { describe, expect, it } from "vitest";

import { buildSlashItems, type SlashContext } from "./chat-slash-commands";
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
  remoteError: null,
  repositoryPrivate: false,
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

  it("puts the typed name's own row first, then other matches", () => {
    const items = buildSlashItems(slash("feat", "branch"), context);
    expect(labels(items)).toEqual([
      "Create branch feat",
      "Switch to feat/login",
      "Open feat/remote",
    ]);
    expect(items[0]!.action).toEqual({
      type: "run",
      action: { type: "create_branch", branch: "feat" },
    });
    const withOld = {
      ...context,
      worktrees: [...context.worktrees, { id: "old", branch: "main-old" }],
    };
    const current = buildSlashItems(slash("main", "branch"), withOld);
    expect(labels(current)).toEqual(["Already on main", "Switch to main-old"]);
    expect(current[0]).toMatchObject({ disabled: true });
  });

  it("never offers to create a branch that exists or isn't valid", () => {
    const items = buildSlashItems(slash("feat/remote", "branch"), context);
    expect(labels(items)).toEqual(["Open feat/remote"]);
    const invalid = buildSlashItems(slash("bad..name", "branch"), context);
    expect(labels(invalid)).toEqual(["Not a valid branch name"]);
    expect(invalid[0]).toMatchObject({ disabled: true });
  });

  it("waits for GitHub's branches before offering to create one", () => {
    const loading = { ...context, remoteBranches: null };
    const items = buildSlashItems(slash("feat/remote", "branch"), loading);
    expect(labels(items)).toEqual(["Loading branches from GitHub…"]);
    expect(items[0]).toMatchObject({ disabled: true });
    // A worktree that matches exactly is known without GitHub.
    expect(
      labels(buildSlashItems(slash("feat/login", "branch"), loading)),
    ).toEqual(["Switch to feat/login", "Loading branches from GitHub…"]);
    const failed = {
      ...loading,
      remoteError: "GitHub took too long to answer.",
    };
    const retry = buildSlashItems(slash("feat", "branch"), failed)[0]!;
    expect(retry).toMatchObject({
      label: "Couldn’t load GitHub branches · Retry",
      action: { type: "retry" },
    });
  });

  it("can't open GitHub branches of a private repository", () => {
    const items = buildSlashItems(slash("feat/remote", "branch"), {
      ...context,
      repositoryPrivate: true,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      label: "Open feat/remote",
      disabled: true,
      action: { type: "notice" },
    });
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
