import { describe, expect, it } from "vitest";

import { readWorkspaceView, workspaceViewUrl } from "./workspace-view-url";

const chatId = "11111111-1111-4111-8111-111111111111";
const page = "https://www.trycodev.com/gen2/ws-1";

describe("workspace view URL", () => {
  it("reads the view a link names and ignores anything malformed", () => {
    expect(
      readWorkspaceView({
        worktree: "yousefs",
        chat: chatId,
        tab: "changes",
        file: "src/app.ts",
        view: "board",
        terminal: "open",
      }),
    ).toEqual({
      worktreeId: "yousefs",
      chatId,
      tab: "changes",
      file: "src/app.ts",
      board: true,
      terminal: true,
    });
    expect(
      readWorkspaceView({
        worktree: "../etc",
        chat: "not-a-uuid",
        tab: "secrets",
        file: "/etc/passwd",
      }),
    ).toEqual({
      worktreeId: null,
      chatId: null,
      tab: null,
      file: null,
      board: false,
      terminal: false,
    });
  });

  it("writes only what differs from the defaults and keeps other parameters", () => {
    const view = {
      worktreeId: "main",
      chatId: null,
      tab: "files" as const,
      file: null,
      board: false,
      terminal: false,
    };
    expect(workspaceViewUrl(`${page}?ref=home`, view)).toBe(`${page}?ref=home`);
    const url = new URL(
      workspaceViewUrl(page, {
        ...view,
        worktreeId: "yousefs",
        chatId,
        tab: "review",
        file: "docs/My Notes (draft).md",
        terminal: true,
      }),
    );
    expect(readWorkspaceView(Object.fromEntries(url.searchParams))).toEqual({
      worktreeId: "yousefs",
      chatId,
      tab: "review",
      file: "docs/My Notes (draft).md",
      board: false,
      terminal: true,
    });
  });
});
