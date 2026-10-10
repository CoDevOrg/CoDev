import type { Gen2SessionImportProvider } from "@codev/contracts";

import {
  summarizeLocalSession,
  type LocalSessionSummary,
} from "./session-import-summary";

/**
 * Lists the agent sessions in a folder the member grants: through the File
 * System Access API where the browser has it (Chrome, Edge), otherwise through
 * a folder input (Firefox, Safari, Brave). Everything here runs in the
 * browser: files are only read to describe them, and nothing leaves the
 * machine until the member picks one to upload.
 */

export type LocalSession = LocalSessionSummary & {
  file: File;
  modifiedAt: number;
};

// Half of Codex rollouts put the first prompt beyond 80 KB of preamble.
const HEAD_BYTES = 512 * 1024;
const TAIL_BYTES = 64 * 1024;
const MAX_SESSIONS = 60;
const MAX_DEPTH = 4;
const READ_BATCH = 8;
// Sub-agent transcripts and tool output live beside Claude sessions.
const SKIPPED_FOLDERS = new Set(["subagents", "tool-results"]);
const SESSIONS_FOLDER: Record<Gen2SessionImportProvider, string> = {
  codex: "sessions",
  claude: "projects",
};

type DirectoryHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
};
type DirectoryPicker = (options: {
  id: string;
  mode: "read";
}) => Promise<DirectoryHandle>;

function directoryPicker(): DirectoryPicker | null {
  if (typeof window === "undefined") return null;
  const picker = (window as { showDirectoryPicker?: DirectoryPicker })
    .showDirectoryPicker;
  return picker ? picker.bind(window) : null;
}

/** How this browser can list a folder, if at all. */
export function localSessionAccess(): "picker" | "input" | null {
  if (directoryPicker()) return "picker";
  if (
    typeof HTMLInputElement !== "undefined" &&
    "webkitdirectory" in HTMLInputElement.prototype
  ) {
    return "input";
  }
  return null;
}

/** Asks for the folder; null when the member cancels. */
export async function pickSessionFolder(
  provider: Gen2SessionImportProvider,
): Promise<DirectoryHandle | null> {
  const picker = directoryPicker();
  if (!picker) return null;
  try {
    // The id makes the picker reopen where the member found it last time.
    return await picker({ id: `codev-${provider}-sessions`, mode: "read" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }
    throw error;
  }
}

async function listSessionFiles(
  directory: DirectoryHandle,
  depth = 0,
): Promise<FileSystemFileHandle[]> {
  const found: FileSystemFileHandle[] = [];
  for await (const entry of directory.values()) {
    if (entry.kind === "file" && entry.name.endsWith(".jsonl")) {
      found.push(entry);
    } else if (
      entry.kind === "directory" &&
      depth < MAX_DEPTH &&
      !SKIPPED_FOLDERS.has(entry.name)
    ) {
      found.push(
        ...(await listSessionFiles(entry as DirectoryHandle, depth + 1)),
      );
    }
  }
  return found;
}

/** The agent's home folder works as well as its sessions folder. */
async function sessionsRoot(
  directory: DirectoryHandle,
  provider: Gen2SessionImportProvider,
) {
  try {
    return (await directory.getDirectoryHandle(
      SESSIONS_FOLDER[provider],
    )) as DirectoryHandle;
  } catch {
    return directory;
  }
}

async function describe(
  provider: Gen2SessionImportProvider,
  file: File,
): Promise<LocalSession | null> {
  const head = await file.slice(0, HEAD_BYTES).text();
  const tail =
    provider === "claude" && file.size > HEAD_BYTES
      ? await file.slice(-TAIL_BYTES).text()
      : "";
  const summary = summarizeLocalSession(provider, head, tail);
  return summary ? { ...summary, file, modifiedAt: file.lastModified } : null;
}

/** The most recently used sessions among the files, newest first. */
async function describeLatest(
  files: File[],
  provider: Gen2SessionImportProvider,
): Promise<LocalSession[]> {
  const newest = [...files].sort((a, b) => b.lastModified - a.lastModified);
  const sessions: LocalSession[] = [];
  for (
    let start = 0;
    start < newest.length && sessions.length < MAX_SESSIONS;
    start += READ_BATCH
  ) {
    const batch = newest.slice(start, start + READ_BATCH);
    const described = await Promise.all(
      batch.map((f) => describe(provider, f)),
    );
    sessions.push(...described.filter((s): s is LocalSession => s !== null));
  }
  return sessions.slice(0, MAX_SESSIONS);
}

export async function scanLocalSessions(
  directory: DirectoryHandle,
  provider: Gen2SessionImportProvider,
): Promise<LocalSession[]> {
  const root = await sessionsRoot(directory, provider);
  const handles = await listSessionFiles(root);
  const files = await Promise.all(handles.map((h) => h.getFile()));
  return describeLatest(files, provider);
}

/**
 * The same listing for a folder chosen with `<input webkitdirectory>`, which
 * hands over every file in it with its path below the chosen folder.
 */
export function scanSelectedFolder(
  selected: Iterable<File>,
  provider: Gen2SessionImportProvider,
): Promise<LocalSession[]> {
  const sessions = [...selected].flatMap((file) => {
    const parts = file.webkitRelativePath.split("/");
    return file.name.endsWith(".jsonl") &&
      !parts.some((part) => SKIPPED_FOLDERS.has(part))
      ? [{ file, parts }]
      : [];
  });
  // parts[0] is the chosen folder; prefer its sessions folder when the
  // member chose the agent's home instead.
  const inSessions = sessions.filter(
    ({ parts }) => parts[1] === SESSIONS_FOLDER[provider],
  );
  const files = (inSessions.length ? inSessions : sessions).map((s) => s.file);
  return describeLatest(files, provider);
}
