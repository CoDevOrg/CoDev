import {
  gen2RelativePathSchema,
  gen2SupersetWorktreeIdSchema,
} from "@codev/contracts";

export type WorkspaceViewTab = "files" | "changes" | "review" | "browser";

/** Where the member is in a workspace: what a refresh or a link restores. */
export type WorkspaceView = {
  worktreeId: string | null;
  chatId: string | null;
  tab: WorkspaceViewTab | null;
  file: string | null;
  board: boolean;
  terminal: boolean;
};

type Query = Record<string, string | string[] | undefined>;

const PRIMARY_WORKTREE_ID = "main";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABS = new Set<string>(["files", "changes", "review", "browser"]);

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/** The view in a workspace page's query. Anything malformed is ignored. */
export function readWorkspaceView(query: Query): WorkspaceView {
  const worktree = first(query.worktree);
  const chat = first(query.chat);
  const tab = first(query.tab);
  const file = first(query.file);
  return {
    worktreeId:
      worktree && gen2SupersetWorktreeIdSchema.safeParse(worktree).success
        ? worktree
        : null,
    chatId: chat && UUID.test(chat) ? chat : null,
    tab: tab && TABS.has(tab) ? (tab as WorkspaceViewTab) : null,
    file: file && gen2RelativePathSchema.safeParse(file).success ? file : null,
    board: first(query.view) === "board",
    terminal: first(query.terminal) === "open",
  };
}

/**
 * The page URL for a view, keeping any other query parameters. Defaults are
 * left out, so a workspace link without a view stays as it was.
 */
export function workspaceViewUrl(current: string, view: WorkspaceView) {
  const url = new URL(current);
  const set = (key: string, value: string | null) =>
    value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
  set(
    "worktree",
    view.worktreeId === PRIMARY_WORKTREE_ID ? null : view.worktreeId,
  );
  set("chat", view.chatId);
  set("tab", view.tab === "files" ? null : view.tab);
  set("file", view.file);
  set("view", view.board ? "board" : null);
  set("terminal", view.terminal ? "open" : null);
  return url.toString();
}
