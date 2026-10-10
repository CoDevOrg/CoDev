"use client";

import { WorkspaceButton } from "./workspace-button";

import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import type {
  Gen2SupersetEntry,
  Gen2SupersetFile,
  Gen2SupersetFileEntry,
} from "@codev/contracts";
import {
  Check,
  ChevronDown,
  Copy,
  FileCode2,
  FilePlus,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  listSupersetFiles,
  readSupersetFile,
  saveSupersetFile,
  createSupersetEntry,
  deleteSupersetEntry,
  moveSupersetEntry,
  SupersetFileApiError,
  DEFAULT_SUPERSET_WORKTREE_ID,
} from "./superset-file-client";
import { useGen2SharedFileDocument } from "./use-gen2-shared-file-document";
import { useFilesChanged } from "./use-files-changed";
import { useRemoteCursors } from "./use-remote-cursors";
import { useWorkspacePresence } from "./use-workspace-presence";
import { useAgentFilePulses } from "./use-agent-file-pulses";
import { FilePresenceDots, presenceUnder } from "./file-presence-dots";
import type {
  FileRequestOutcome,
  FileRevealRange,
} from "./use-workspace-file-request";
import type { EditorSelectionText } from "./superset-code-editor";

const SupersetCodeEditor = dynamic(
  () =>
    import("./superset-code-editor").then(
      (module) => module.SupersetCodeEditor,
    ),
  {
    ssr: false,
    loading: () => <div className="gen2-superset-code-editor-skeleton" />,
  },
);

type FileTree = {
  name: string;
  path: string;
  folders: Map<string, FileTree>;
  files: Gen2SupersetFileEntry[];
};

type Notice = {
  kind: "error" | "info" | "success" | "conflict";
  text: string;
  transient?: boolean;
};

function buildFileTree(entries: Gen2SupersetEntry[]): FileTree {
  const root: FileTree = { name: "", path: "", folders: new Map(), files: [] };
  for (const entry of entries) {
    const parts = entry.path.split("/");
    let folder = root;
    const folderParts = entry.kind === "directory" ? parts : parts.slice(0, -1);
    for (const name of folderParts) {
      let child = folder.folders.get(name);
      if (!child) {
        child = {
          name,
          path: folder.path ? `${folder.path}/${name}` : name,
          folders: new Map(),
          files: [],
        };
        folder.folders.set(name, child);
      }
      folder = child;
    }
    if (entry.kind === "file") folder.files.push(entry);
  }
  return root;
}

function fileName(path: string) {
  return path.split("/").at(-1) ?? path;
}

function parentPath(path: string) {
  return path.includes("/")
    ? (path.split("/").slice(0, -1).join("/") ?? "")
    : "";
}

function isPathOrDescendant(path: string, ancestor: string) {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

function errorMessage(error: unknown, fallback: string) {
  if (!(error instanceof SupersetFileApiError) || error.status === 503)
    return fallback;
  return error.message;
}

async function listFilesWhenReady(
  workspaceId: string,
  worktreeId: string,
  signal?: AbortSignal,
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await listSupersetFiles(workspaceId, worktreeId, signal);
    } catch (error) {
      if (
        signal?.aborted ||
        !(error instanceof SupersetFileApiError) ||
        error.message !== "The workspace is still starting." ||
        attempt >= 2
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

function TreeEntryMenu({
  label,
  disabled,
  onOpenChange,
  children,
}: {
  label: string;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <WorkspaceButton
          tone="ghost"
          size="icon"
          type="button"
          className="gen2-superset-tree-action"
          aria-label={label}
          title={label}
          disabled={disabled}
        >
          <MoreHorizontal aria-hidden="true" />
        </WorkspaceButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="gen2-workspace-surface">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Browser adaptation of Superset's FilePane backed by CoDev's Gen 2 file API. */
export function SupersetFilePane({
  workspaceId,
  canEdit,
  workspaceReady = true,
  worktreeId = DEFAULT_SUPERSET_WORKTREE_ID,
  refreshToken,
  onDirtyChange,
  portalTarget,
  onOpenFile,
  requestedPath,
  onRequestedPathConsumed,
  requestedRange,
  onRangeRevealed,
  onSelectionText,
  followCursorId,
}: {
  workspaceId: string;
  canEdit: boolean;
  workspaceReady?: boolean;
  worktreeId?: string | undefined;
  refreshToken?: number | undefined;
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
  portalTarget?: HTMLElement | null | undefined;
  onOpenFile?: ((file: Gen2SupersetFile | null) => void) | undefined;
  requestedPath?: string | null | undefined;
  /** Says whether the request opened a file, was dropped while busy, or declined. */
  onRequestedPathConsumed?: ((outcome: FileRequestOutcome) => void) | undefined;
  /** Lines to reveal once their file is open. */
  requestedRange?: FileRevealRange | null | undefined;
  /** The range was shown; it is never applied again, even on reopening. */
  onRangeRevealed?: ((id: number) => void) | undefined;
  onSelectionText?:
    | ((selection: (EditorSelectionText & { path: string }) | null) => void)
    | undefined;
  /** In follow mode, the followed member's cursor to keep in view. */
  followCursorId?: string | null | undefined;
}) {
  const [files, setFiles] = useState<Gen2SupersetEntry[]>([]);
  const [openFile, setOpenFile] = useState<Gen2SupersetFile | null>(null);

  useEffect(() => {
    onOpenFile?.(openFile);
  }, [openFile, onOpenFile]);
  const [contents, setContents] = useState("");
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const isLoadingFiles = workspaceReady && loadingFiles;
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [createKind, setCreateKind] = useState<"file" | "directory" | null>(
    null,
  );
  const [createParentPath, setCreateParentPath] = useState("");
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [renameEntry, setRenameEntry] = useState<Gen2SupersetEntry | null>(
    null,
  );
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [deleteEntry, setDeleteEntry] = useState<Gen2SupersetEntry | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const openFileRef = useRef(openFile);
  const contentsRef = useRef(contents);
  const savingRef = useRef(false);
  const openRequestId = useRef(0);
  const wasRequested = useRef(false);
  const listRequestId = useRef(0);
  const dirty = openFile !== null && contents !== openFile.contents;
  const sharedDocument = useGen2SharedFileDocument({
    workspaceId,
    worktreeId,
    path: openFile?.path ?? null,
    canEdit,
    onContentsChange: (next) => {
      contentsRef.current = next;
      setContents(next);
      // The shared document autosaves, so it is never "unsaved" here: no
      // Save button, and no save-or-discard prompt when switching away.
      const file = openFileRef.current;
      if (!file || file.contents === next) return;
      openFileRef.current = { ...file, contents: next };
      setOpenFile(openFileRef.current);
    },
  });

  // Edits go through the shared document and autosave; no Save button.
  const sharedEditing =
    sharedDocument.state === "connected" && sharedDocument.text !== null;
  const { byPath } = useWorkspacePresence(worktreeId);
  const agentPulses = useAgentFilePulses(worktreeId);
  const remoteCursors = useRemoteCursors({
    awareness: sharedDocument.awareness,
    worktreeId,
    path: openFile?.path ?? null,
  });

  useEffect(() => {
    openFileRef.current = openFile;
    contentsRef.current = contents;
  }, [openFile, contents]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!deleteEntry) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) setDeleteEntry(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [deleteEntry, deleting]);

  const openPath = useCallback(
    async (path: string, signal?: AbortSignal) => {
      const requestId = ++openRequestId.current;
      setOpeningPath(path);
      try {
        const file = await readSupersetFile(
          workspaceId,
          worktreeId,
          path,
          signal,
        );
        if (signal?.aborted || requestId !== openRequestId.current) return;
        openFileRef.current = file;
        contentsRef.current = file.contents;
        setOpenFile(file);
        setContents(file.contents);
        setStale(false);
        setNotice(null);
        setExpandedFolders((current) => {
          const next = new Set(current);
          const parts = path.split("/");
          for (let i = 1; i < parts.length; i += 1) {
            next.add(parts.slice(0, i).join("/"));
          }
          return next;
        });
      } catch (error) {
        if (!signal?.aborted && requestId === openRequestId.current) {
          setNotice({
            kind: "error",
            text: errorMessage(error, "Couldn’t open this file. Try again."),
          });
        }
      } finally {
        if (!signal?.aborted && requestId === openRequestId.current) {
          setOpeningPath(null);
        }
      }
    },
    [workspaceId, worktreeId],
  );

  const refreshFiles = useCallback(
    async (selectFirst = false, quiet = false, signal?: AbortSignal) => {
      const requestId = ++listRequestId.current;
      if (!quiet) setLoadingFiles(true);
      try {
        const nextFiles = await listFilesWhenReady(
          workspaceId,
          worktreeId,
          signal,
        );
        if (signal?.aborted || requestId !== listRequestId.current) return;
        const visibleFiles = nextFiles.filter((file) => file.path !== ".git");
        setFiles(visibleFiles);
        // Only a fresh pane picks a file itself; never over a requested one.
        if (
          selectFirst &&
          !openFileRef.current &&
          !wasRequested.current &&
          visibleFiles.length > 0
        ) {
          const preferred =
            visibleFiles.find(
              (file) =>
                file.kind === "file" &&
                file.size <= 2 * 1024 * 1024 &&
                /\.(tsx?|jsx?|py|rs|md|json|css|html)$/i.test(file.path),
            ) ??
            visibleFiles.find(
              (file) => file.kind === "file" && file.size <= 2 * 1024 * 1024,
            );
          if (preferred) void openPath(preferred.path, signal);
        }
        if (!quiet)
          setNotice((current) =>
            current?.transient ||
            (current?.kind === "error" && !openFileRef.current)
              ? null
              : current,
          );
      } catch (error) {
        if (!signal?.aborted && requestId === listRequestId.current) {
          setNotice({
            kind: "error",
            transient:
              error instanceof SupersetFileApiError &&
              error.message === "The workspace is still starting.",
            text: errorMessage(
              error,
              "Couldn’t load files. Use Refresh files to retry.",
            ),
          });
        }
      } finally {
        if (
          !signal?.aborted &&
          (requestId === listRequestId.current || !quiet)
        ) {
          setLoadingFiles(false);
        }
      }
    },
    [workspaceId, worktreeId, openPath],
  );

  // Another member or an agent changed this worktree: refresh in place.
  useFilesChanged(worktreeId, 400, () => {
    if (workspaceReady) void refreshFiles(false, true);
  });

  useEffect(() => {
    if (!workspaceReady) return;
    const controller = new AbortController();
    // The client API request starts here after the authenticated page mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshFiles(true, false, controller.signal);
    return () => controller.abort();
  }, [refreshFiles, refreshToken, workspaceReady]);

  async function save() {
    const file = openFileRef.current;
    const draft = contentsRef.current;
    if (!canEdit || !file || draft === file.contents || savingRef.current)
      return;
    if (stale || sharedDocument.state === "conflict") {
      setNotice({
        kind: "conflict",
        text: "Reload the latest file before saving. Copy your changes first if you want to keep them.",
      });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setNotice(null);
    try {
      const saved = await saveSupersetFile(
        workspaceId,
        worktreeId,
        file,
        draft,
      );
      const editedDuringSave = contentsRef.current !== draft;
      openFileRef.current = saved;
      setOpenFile(saved);
      if (!editedDuringSave) {
        contentsRef.current = saved.contents;
        setContents(saved.contents);
      }
      setStale(false);
      setNotice({
        kind: "success",
        text: editedDuringSave
          ? "Saved. Your newer edits are still unsaved."
          : "File saved.",
      });
    } catch (error) {
      if (error instanceof SupersetFileApiError && error.status === 409) {
        setStale(true);
        setNotice({
          kind: "conflict",
          text: "This file changed elsewhere. Your edits are safe here. Copy them or reload the latest file.",
        });
      } else {
        setNotice({
          kind: "error",
          text: errorMessage(error, "Couldn’t save this file. Try again."),
        });
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function startCreate(kind: "file" | "directory", parent = "") {
    setCreateKind(kind);
    setCreateParentPath(parent);
    setCreateName(kind === "file" ? "untitled.txt" : "untitled-folder");
    setMenuPath(null);
    setRenameEntry(null);
    setRenameName("");
    setNotice(null);
  }

  async function createEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const kind = createKind;
    const name = createName.trim();
    if (!kind || !name || creating) return;
    setCreating(true);
    setNotice(null);
    try {
      const entry = await createSupersetEntry(workspaceId, worktreeId, {
        parentPath: createParentPath,
        name,
        kind,
      });
      setCreateKind(null);
      setCreateParentPath("");
      setCreateName("");
      await refreshFiles(false, true);
      const current = openFileRef.current;
      const hasUnsavedChanges =
        current !== null && contentsRef.current !== current.contents;
      if (entry.kind === "file" && !hasUnsavedChanges) {
        await openPath(entry.path);
      }
      setNotice({
        kind: "success",
        text:
          entry.kind === "file" && hasUnsavedChanges
            ? `File ${entry.path} created. Save or discard your current changes before opening it.`
            : `${entry.kind === "file" ? "File" : "Folder"} ${entry.path} created.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: errorMessage(
          error,
          "Couldn’t create this entry. Try another name.",
        ),
      });
    } finally {
      setCreating(false);
    }
  }

  function startRename(entry: Gen2SupersetEntry) {
    setMenuPath(null);
    setCreateKind(null);
    setCreateParentPath("");
    setRenameEntry(entry);
    setRenameName(fileName(entry.path));
    setNotice(null);
  }

  async function renameEntrySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entry = renameEntry;
    const name = renameName.trim();
    if (!entry || !name || renaming) return;
    const current = openFileRef.current;
    if (
      current &&
      isPathOrDescendant(current.path, entry.path) &&
      contentsRef.current !== current.contents
    ) {
      setNotice({
        kind: "error",
        text: "Save or discard unsaved changes before renaming this open file or folder.",
      });
      return;
    }
    setRenaming(true);
    setNotice(null);
    try {
      const moved = await moveSupersetEntry(workspaceId, worktreeId, {
        path: entry.path,
        parentPath: parentPath(entry.path),
        name,
      });
      setRenameEntry(null);
      setRenameName("");
      await refreshFiles(false, true);
      if (current && isPathOrDescendant(current.path, entry.path)) {
        const suffix = current.path.slice(entry.path.length);
        await openPath(`${moved.path}${suffix}`);
      }
      setNotice({
        kind: "success",
        text: `${entry.kind === "file" ? "File" : "Folder"} renamed to ${moved.path}.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: errorMessage(
          error,
          "Couldn’t rename this entry. Try another name.",
        ),
      });
    } finally {
      setRenaming(false);
    }
  }

  function requestDelete(entry: Gen2SupersetEntry) {
    setMenuPath(null);
    const current = openFileRef.current;
    if (
      current &&
      isPathOrDescendant(current.path, entry.path) &&
      contentsRef.current !== current.contents
    ) {
      setNotice({
        kind: "error",
        text: "Save or discard unsaved changes before deleting this open file or folder.",
      });
      return;
    }
    setDeleteEntry(entry);
  }

  async function confirmDelete() {
    const entry = deleteEntry;
    if (!entry || deleting) return;
    setDeleting(true);
    setNotice(null);
    try {
      await deleteSupersetEntry(workspaceId, worktreeId, entry.path);
      const current = openFileRef.current;
      if (current && isPathOrDescendant(current.path, entry.path)) {
        openFileRef.current = null;
        contentsRef.current = "";
        setOpenFile(null);
        setContents("");
        setStale(false);
      }
      setDeleteEntry(null);
      await refreshFiles(false, true);
      setNotice({
        kind: "success",
        text: `${entry.kind === "file" ? "File" : "Folder"} ${entry.path} deleted.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: errorMessage(error, "Couldn’t delete this entry. Try again."),
      });
    } finally {
      setDeleting(false);
    }
  }

  const selectFile = useCallback(
    (path: string): FileRequestOutcome => {
      if (path === openFileRef.current?.path) return "same";
      if (savingRef.current || openingPath) return "busy";
      const current = openFileRef.current;
      if (
        current &&
        contentsRef.current !== current.contents &&
        !window.confirm("Discard your unsaved changes and open another file?")
      )
        return "declined";
      void openPath(path);
      return "opened";
    },
    [openingPath, openPath],
  );

  // Answer each request once, even as `selectFile` changes while it opens.
  const answeredPath = useRef<string | null>(null);
  useEffect(() => {
    if (answeredPath.current === requestedPath) return;
    answeredPath.current = requestedPath ?? null;
    if (!requestedPath) return;
    wasRequested.current = true;
    onRequestedPathConsumed?.(selectFile(requestedPath));
  }, [requestedPath, selectFile, onRequestedPathConsumed]);

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      if (label === "Path") setCopied(true);
      setNotice((current) =>
        current?.kind === "conflict"
          ? current
          : { kind: "success", text: `${label} copied.` },
      );
      if (label === "Path") window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setNotice((current) =>
        current?.kind === "conflict"
          ? {
              ...current,
              text: `${current.text} Clipboard unavailable; select and copy from the editor.`,
            }
          : { kind: "error", text: `Couldn’t copy ${label.toLowerCase()}.` },
      );
    }
  }

  function reloadLatest() {
    const file = openFileRef.current;
    if (!file || openingPath || savingRef.current) return;
    if (
      contentsRef.current !== file.contents &&
      !window.confirm("Discard your unsaved changes and load the latest file?")
    )
      return;
    void openPath(file.path);
  }

  const visibleFiles = query.trim()
    ? files.filter((entry) =>
        entry.path.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : files;
  const tree = buildFileTree(visibleFiles);

  function renderTree(folder: FileTree, level: number) {
    const children = Array.from(folder.folders.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const menuDisabled = creating || renaming || deleting;
    return (
      <>
        {children.map((child) => {
          const expanded =
            Boolean(query.trim()) || expandedFolders.has(child.path);
          return (
            <li role="none" key={child.path}>
              <div
                className="gen2-superset-tree-row"
                data-menu-open={menuPath === child.path || undefined}
              >
                <button
                  type="button"
                  className="gen2-superset-folder"
                  role="treeitem"
                  aria-expanded={expanded}
                  aria-level={level}
                  aria-selected={false}
                  title={child.path}
                  style={{ paddingLeft: `${8 + (level - 1) * 12}px` }}
                  onClick={() =>
                    setExpandedFolders((current) => {
                      const next = new Set(current);
                      if (next.has(child.path)) next.delete(child.path);
                      else next.add(child.path);
                      return next;
                    })
                  }
                >
                  <ChevronDown
                    aria-hidden="true"
                    className={
                      expanded ? undefined : "gen2-superset-chevron-closed"
                    }
                  />
                  <Folder aria-hidden="true" />
                  <span className="gen2-superset-tree-label">{child.name}</span>
                  {expanded ? null : (
                    <FilePresenceDots
                      entries={presenceUnder(byPath, child.path)}
                    />
                  )}
                </button>
                {canEdit ? (
                  <TreeEntryMenu
                    label={`Actions for ${child.path}`}
                    disabled={menuDisabled}
                    onOpenChange={(open) =>
                      setMenuPath(open ? child.path : null)
                    }
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onSelect={() => startCreate("file", child.path)}
                      >
                        <FilePlus aria-hidden="true" /> New file
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => startCreate("directory", child.path)}
                      >
                        <FolderPlus aria-hidden="true" /> New folder
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          startRename({ path: child.path, kind: "directory" })
                        }
                      >
                        <Pencil aria-hidden="true" /> Rename
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onSelect={() =>
                          requestDelete({ path: child.path, kind: "directory" })
                        }
                      >
                        <Trash2 aria-hidden="true" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </TreeEntryMenu>
                ) : null}
              </div>
              {expanded ? (
                <ul role="group">{renderTree(child, level + 1)}</ul>
              ) : null}
            </li>
          );
        })}
        {folder.files.map((file) => {
          const selected = file.path === openFile?.path;
          return (
            <li role="none" key={file.path}>
              <div
                className="gen2-superset-tree-row"
                data-menu-open={menuPath === file.path || undefined}
                data-agent-pulse={agentPulses.has(file.path) || undefined}
              >
                <button
                  type="button"
                  role="treeitem"
                  aria-level={level}
                  aria-selected={selected}
                  aria-current={selected ? "page" : undefined}
                  className="gen2-superset-file"
                  title={file.path}
                  style={{ paddingLeft: `${8 + (level - 1) * 12}px` }}
                  disabled={saving}
                  onClick={() => selectFile(file.path)}
                >
                  <FileCode2 aria-hidden="true" />
                  <span className="gen2-superset-tree-label">
                    {fileName(file.path)}
                  </span>
                  <FilePresenceDots entries={byPath.get(file.path)} />
                  {selected && dirty ? (
                    <span
                      className="gen2-superset-dirty"
                      aria-label="Unsaved changes"
                    />
                  ) : null}
                </button>
                {canEdit ? (
                  <TreeEntryMenu
                    label={`Actions for ${file.path}`}
                    disabled={menuDisabled}
                    onOpenChange={(open) =>
                      setMenuPath(open ? file.path : null)
                    }
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuItem onSelect={() => startRename(file)}>
                        <Pencil aria-hidden="true" /> Rename
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem onSelect={() => requestDelete(file)}>
                        <Trash2 aria-hidden="true" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </TreeEntryMenu>
                ) : null}
              </div>
            </li>
          );
        })}
      </>
    );
  }

  const tabStripNode = openFile ? (
    <header className="gen2-superset-tab-strip">
      <div
        className="gen2-superset-tab"
        aria-current="page"
        aria-label={`Open file: ${fileName(openFile.path)}`}
        title={openFile.path}
      >
        <FileCode2 aria-hidden="true" />
        <span className="gen2-superset-tab-name">
          {fileName(openFile.path)}
        </span>
        <FilePresenceDots entries={byPath.get(openFile.path)} />
        {dirty ? (
          <span className="gen2-superset-dirty" aria-label="Unsaved changes" />
        ) : null}
      </div>
    </header>
  ) : null;

  const editorSection = (
    <section
      className="gen2-superset-editor"
      aria-label="Code editor"
      aria-busy={Boolean(openingPath)}
    >
      {openFile ? (
        <header className="gen2-superset-editor-bar">
          <span className="gen2-superset-path" title={openFile?.path}>
            {openFile?.path ?? "No file open"}
          </span>
          <div className="gen2-superset-editor-actions">
            {openFile && (!canEdit || !workspaceReady) ? (
              <span className="gen2-superset-read-only">
                {workspaceReady ? "Read only" : "Offline · read only"}
              </span>
            ) : null}
            {openFile ? (
              <span
                className="gen2-superset-collaboration-state"
                role="status"
                aria-live="polite"
              >
                {sharedEditing
                  ? `${
                      sharedDocument.members.length > 1
                        ? `${sharedDocument.members.length - 1} collaborator${sharedDocument.members.length === 2 ? "" : "s"} editing`
                        : "Shared editing"
                    } · ${sharedDocument.saving ? "Saving…" : "Saved"}`
                  : sharedDocument.state === "conflict"
                    ? "Resolve conflict"
                    : "Syncing collaboration…"}
              </span>
            ) : null}
            {sharedEditing ? null : (
              <WorkspaceButton
                tone="secondary"
                type="button"
                className="gen2-superset-save"
                disabled={
                  !canEdit ||
                  !workspaceReady ||
                  !dirty ||
                  saving ||
                  Boolean(openingPath) ||
                  stale ||
                  sharedDocument.readOnly ||
                  sharedDocument.state === "conflict"
                }
                onClick={() => void save()}
              >
                {saving ? "Saving…" : "Save"}
              </WorkspaceButton>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <WorkspaceButton
                  tone="ghost"
                  size="icon"
                  type="button"
                  className="gen2-superset-icon-button"
                  onClick={() =>
                    openFile && void copyText(openFile.path, "Path")
                  }
                  aria-label="Copy path"
                  disabled={!openFile}
                >
                  {copied ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <Copy aria-hidden="true" />
                  )}
                </WorkspaceButton>
              </TooltipTrigger>
              <TooltipContent className="gen2-workspace-surface">
                {copied ? "Copied" : "Copy path"}
              </TooltipContent>
            </Tooltip>
          </div>
        </header>
      ) : null}
      {notice ? (
        <div
          className={`gen2-superset-notice gen2-superset-notice-${notice.kind}`}
          role={
            notice.kind === "error" || notice.kind === "conflict"
              ? "alert"
              : "status"
          }
        >
          <span>{notice.text}</span>
          {notice.kind === "conflict" && openFile ? (
            <span className="gen2-superset-notice-actions">
              <WorkspaceButton
                tone="ghost"
                type="button"
                onClick={() => void copyText(contentsRef.current, "Changes")}
              >
                Copy changes
              </WorkspaceButton>
              <WorkspaceButton
                tone="ghost"
                type="button"
                onClick={reloadLatest}
              >
                Reload latest
              </WorkspaceButton>
            </span>
          ) : null}
          {notice.kind === "error" && !openFile ? (
            <WorkspaceButton
              tone="ghost"
              type="button"
              onClick={() => void refreshFiles(true)}
            >
              Retry
            </WorkspaceButton>
          ) : null}
        </div>
      ) : null}
      {sharedDocument.notice || sharedDocument.state === "conflict" ? (
        <div
          className="gen2-superset-notice gen2-superset-notice-info"
          role={sharedDocument.state === "conflict" ? "alert" : "status"}
          aria-live="polite"
        >
          <span>
            {sharedDocument.notice ??
              "This file and the shared editor disagree. Choose which to keep."}
          </span>
          {sharedDocument.state === "conflict" && canEdit ? (
            <span className="gen2-superset-notice-actions">
              <WorkspaceButton
                tone="ghost"
                type="button"
                onClick={() => sharedDocument.resolveConflict("editor")}
              >
                Keep editor version
              </WorkspaceButton>
              <WorkspaceButton
                tone="ghost"
                type="button"
                onClick={() => sharedDocument.resolveConflict("workspace")}
              >
                Use workspace version
              </WorkspaceButton>
            </span>
          ) : null}
        </div>
      ) : null}
      {openingPath ? (
        <p className="gen2-superset-empty-state" role="status">
          Opening {fileName(openingPath)}…
        </p>
      ) : openFile ? (
        <SupersetCodeEditor
          key={openFile.path}
          path={openFile.path}
          value={contents}
          sharedText={
            sharedDocument.state === "connected" ? sharedDocument.text : null
          }
          readOnly={!canEdit || !workspaceReady || sharedDocument.readOnly}
          onChange={(next) => {
            contentsRef.current = next;
            setContents(next);
            if (!stale) setNotice(null);
          }}
          onSelectionChange={sharedDocument.updateCursor}
          remoteCursors={remoteCursors}
          followPosition={
            followCursorId
              ? (remoteCursors.find(
                  (cursor) =>
                    cursor.id === followCursorId ||
                    cursor.id.startsWith(`${followCursorId}:`),
                )?.head ?? null)
              : null
          }
          onSelectionText={(selection) =>
            onSelectionText?.(
              selection && { path: openFile.path, ...selection },
            )
          }
          revealRange={
            requestedRange?.path === openFile.path ? requestedRange : null
          }
          onRangeRevealed={onRangeRevealed}
          onSave={() => void save()}
        />
      ) : workspaceReady ? (
        <p className="gen2-superset-empty-state">Select a file to open it.</p>
      ) : null}
    </section>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <>
        <main
          className="gen2-superset-file-pane"
          aria-label="Superset file pane"
          data-portaled={Boolean(portalTarget)}
          data-has-open-file={Boolean(openFile)}
        >
          <aside className="gen2-superset-file-list" aria-label="Files">
            <header className="gen2-superset-files-header">
              <label className="gen2-superset-search">
                <Search aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Search files"
                  placeholder="Search files"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div
                className="gen2-superset-files-actions"
                aria-label="File actions"
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <WorkspaceButton
                      tone="ghost"
                      size="icon"
                      type="button"
                      className="gen2-superset-icon-button"
                      aria-label="New file"
                      disabled={!canEdit || creating}
                      onClick={() => startCreate("file")}
                    >
                      <FilePlus aria-hidden="true" />
                    </WorkspaceButton>
                  </TooltipTrigger>
                  <TooltipContent className="gen2-workspace-surface">
                    New file
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <WorkspaceButton
                      tone="ghost"
                      size="icon"
                      type="button"
                      className="gen2-superset-icon-button"
                      aria-label="New folder"
                      disabled={!canEdit || creating}
                      onClick={() => startCreate("directory")}
                    >
                      <FolderPlus aria-hidden="true" />
                    </WorkspaceButton>
                  </TooltipTrigger>
                  <TooltipContent className="gen2-workspace-surface">
                    New folder
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <WorkspaceButton
                      tone="ghost"
                      size="icon"
                      type="button"
                      className="gen2-superset-icon-button"
                      aria-label="Refresh files"
                      disabled={isLoadingFiles || !workspaceReady}
                      onClick={() => void refreshFiles(true)}
                    >
                      <RefreshCw aria-hidden="true" />
                    </WorkspaceButton>
                  </TooltipTrigger>
                  <TooltipContent className="gen2-workspace-surface">
                    Refresh files
                  </TooltipContent>
                </Tooltip>
              </div>
            </header>
            {createKind ? (
              <form
                className="gen2-superset-create-entry"
                onSubmit={createEntry}
              >
                <label>
                  <span>
                    {createKind === "file"
                      ? "New file name"
                      : "New folder name"}
                  </span>
                  <input
                    autoFocus
                    value={createName}
                    onChange={(event) => setCreateName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && !creating) {
                        event.preventDefault();
                        setCreateKind(null);
                        setCreateParentPath("");
                      }
                    }}
                    disabled={creating}
                    aria-describedby="gen2-superset-create-entry-help"
                  />
                </label>
                <p id="gen2-superset-create-entry-help">
                  {createParentPath
                    ? `Created in ${createParentPath}.`
                    : "Created at the workspace root."}
                </p>
                <div>
                  <WorkspaceButton
                    tone="ghost"
                    type="button"
                    disabled={creating}
                    onClick={() => {
                      setCreateKind(null);
                      setCreateParentPath("");
                    }}
                  >
                    Cancel
                  </WorkspaceButton>
                  <WorkspaceButton
                    tone="primary"
                    type="submit"
                    disabled={!createName.trim() || creating}
                  >
                    {creating ? "Creating…" : "Create"}
                  </WorkspaceButton>
                </div>
              </form>
            ) : null}
            {renameEntry ? (
              <form
                className="gen2-superset-create-entry"
                onSubmit={renameEntrySubmit}
              >
                <label>
                  <span>Rename {renameEntry.kind}</span>
                  <input
                    autoFocus
                    value={renameName}
                    onChange={(event) => setRenameName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && !renaming) {
                        event.preventDefault();
                        setRenameEntry(null);
                        setRenameName("");
                      }
                    }}
                    disabled={renaming}
                    aria-describedby="gen2-superset-rename-entry-help"
                  />
                </label>
                <p id="gen2-superset-rename-entry-help">{renameEntry.path}</p>
                <div>
                  <WorkspaceButton
                    tone="ghost"
                    type="button"
                    disabled={renaming}
                    onClick={() => {
                      setRenameEntry(null);
                      setRenameName("");
                    }}
                  >
                    Cancel
                  </WorkspaceButton>
                  <WorkspaceButton
                    tone="primary"
                    type="submit"
                    disabled={!renameName.trim() || renaming}
                  >
                    {renaming ? "Renaming…" : "Rename"}
                  </WorkspaceButton>
                </div>
              </form>
            ) : null}
            {isLoadingFiles ? (
              <p className="gen2-superset-list-state" role="status">
                Loading files…
              </p>
            ) : visibleFiles.length === 0 ? (
              <p className="gen2-superset-list-state">
                {!workspaceReady
                  ? "Files load when the workspace is connected."
                  : query
                    ? "No files match your search."
                    : notice?.kind === "error"
                      ? notice.text
                      : "No files found. Refresh to try again."}
              </p>
            ) : (
              <ul role="tree" aria-label="Workspace files">
                {renderTree(tree, 1)}
              </ul>
            )}
          </aside>

          {portalTarget ? null : editorSection}
          {deleteEntry ? (
            <div
              className="gen2-superset-dialog-backdrop"
              onMouseDown={(event) => {
                if (event.currentTarget === event.target && !deleting) {
                  setDeleteEntry(null);
                }
              }}
            >
              <section
                className="gen2-superset-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="gen2-superset-delete-title"
                aria-describedby="gen2-superset-delete-description"
              >
                <h2 id="gen2-superset-delete-title">
                  Delete {deleteEntry.kind}?
                </h2>
                <p id="gen2-superset-delete-description">
                  Delete <strong>{deleteEntry.path}</strong> permanently?
                  {deleteEntry.kind === "directory"
                    ? " Every file and folder inside it will be deleted too."
                    : " This cannot be undone from this workspace."}
                </p>
                <div className="gen2-superset-dialog-actions">
                  <WorkspaceButton
                    tone="ghost"
                    type="button"
                    autoFocus
                    disabled={deleting}
                    onClick={() => setDeleteEntry(null)}
                  >
                    Cancel
                  </WorkspaceButton>
                  <WorkspaceButton
                    tone="destructive"
                    type="button"
                    className="gen2-superset-dialog-delete"
                    disabled={deleting}
                    onClick={() => void confirmDelete()}
                  >
                    {deleting ? "Deleting…" : "Delete permanently"}
                  </WorkspaceButton>
                </div>
              </section>
            </div>
          ) : null}
        </main>
        {portalTarget
          ? createPortal(
              <div className="gen2-superset-editor-wrapper">
                {tabStripNode}
                {editorSection}
              </div>,
              portalTarget,
            )
          : null}
      </>
    </TooltipProvider>
  );
}
