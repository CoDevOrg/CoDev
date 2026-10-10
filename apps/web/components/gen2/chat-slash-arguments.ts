import {
  gen2RelativePathSchema,
  type Gen2WorkspaceAction,
} from "@codev/contracts";

import { matchComposerFiles } from "./chat-file-match";
import { slashBranchItems } from "./chat-slash-branches";
import type { SlashContext } from "./chat-slash-commands";
import type {
  ComposerMenuAction,
  ComposerMenuItem,
} from "./use-composer-typeahead";

const run = (action: Gen2WorkspaceAction): ComposerMenuAction => ({
  type: "run",
  action,
});

function fileItems(value: string, context: SlashContext): ComposerMenuItem[] {
  const valid = gen2RelativePathSchema.safeParse(value).success;
  if (!context.files)
    return value && valid
      ? [
          {
            id: "open-path",
            group: "Files",
            label: `Open ${value}`,
            icon: "file",
            action: run({ type: "open_file", path: value }),
          },
        ]
      : [];
  const files = context.files.filter((entry) => entry.kind === "file");
  return matchComposerFiles(files, value, 8).map((entry) => ({
    id: `open-${entry.path}`,
    group: "Files",
    label: entry.path,
    icon: "file",
    action: run({ type: "open_file", path: entry.path }),
  }));
}

function workspaceItem(
  id: "rename" | "share" | "preview",
  label: string,
  action: Gen2WorkspaceAction,
): ComposerMenuItem[] {
  return [{ id, group: "Workspace", label, icon: id, action: run(action) }];
}

/** The typed port, or the known one when nothing is typed; 0 when neither. */
function previewPort(value: string, context: SlashContext) {
  const port = value ? Number(value) : (context.knownPort ?? 0);
  return /^\d{0,5}$/.test(value) && port >= 1 && port <= 65_535 ? port : 0;
}

/** The menu while a workspace command's argument is typed. */
export function slashArgumentItems(
  command: string,
  value: string,
  context: SlashContext,
): ComposerMenuItem[] {
  const title = value.slice(0, 80);
  const port = previewPort(value, context);
  switch (command) {
    case "open":
      return fileItems(value, context);
    case "branch":
      return slashBranchItems(value, context);
    case "rename":
      return title
        ? workspaceItem("rename", `Rename this chat to “${title}”`, {
            type: "rename_chat",
            title,
          })
        : [];
    case "share":
      return workspaceItem(
        "share",
        value ? `Share with ${value}` : "Open Share",
        {
          type: "open_share",
          ...(value ? { emailOrLogin: value.slice(0, 256) } : {}),
        },
      );
    case "preview":
      return port
        ? workspaceItem("preview", `Preview :${port}`, {
            type: "open_preview",
            port,
          })
        : [];
    default:
      return [];
  }
}
