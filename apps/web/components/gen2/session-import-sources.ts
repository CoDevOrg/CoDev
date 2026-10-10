import type { Gen2SessionImportProvider } from "@codev/contracts";

/** Where each agent keeps its sessions, as the member's system spells it. */

export type Platform = "windows" | "unix";

export const SESSION_SOURCES: Record<
  Gen2SessionImportProvider,
  {
    label: string;
    folder: Record<Platform, string>;
    file: Record<Platform, string>;
  }
> = {
  codex: {
    label: "Codex",
    folder: {
      windows: "%USERPROFILE%\\.codex\\sessions",
      unix: "~/.codex/sessions",
    },
    file: {
      windows: "YYYY\\MM\\DD\\rollout-….jsonl",
      unix: "YYYY/MM/DD/rollout-….jsonl",
    },
  },
  claude: {
    label: "Claude Code",
    folder: {
      windows: "%USERPROFILE%\\.claude\\projects",
      unix: "~/.claude/projects",
    },
    file: {
      windows: "<project>\\<session id>.jsonl",
      unix: "<project>/<session id>.jsonl",
    },
  },
};

// How to reach a hidden dot-folder from the browser's file or folder picker.
export const PICKER_TIP: Record<Platform, string> = {
  windows: "Paste the folder into the picker's address or name box.",
  unix: "On macOS, press ⌘⇧G in the picker and paste the folder.",
};

export function currentPlatform(): Platform {
  return typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent)
    ? "windows"
    : "unix";
}
