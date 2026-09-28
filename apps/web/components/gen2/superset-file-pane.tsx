"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
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

type Notice = { kind: "error" | "info" | "success" | "conflict"; text: string };

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
  return error instanceof SupersetFileApiError ? error.message : fallback;
}

/** Browser adaptation of Superset's FilePane backed by CoDev's Gen 2 file API. */
export function SupersetFilePane({
  workspaceId,
  canEdit,
  worktreeId = DEFAULT_SUPERSET_WORKTREE_ID,
  onDirtyChange,
}: {
  workspaceId: string;
  canEdit: boolean;
  worktreeId?: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [files, setFiles] = useState<Gen2SupersetEntry[]>([]);
  const [openFile, setOpenFile] = useState<Gen2SupersetFile | null>(null);
  const [contents, setContents] = useState("");
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(true);
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
  const [actionEntry, setActionEntry] = useState<Gen2SupersetEntry | null>(
    null,
  );
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
    },
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
        const nextFiles = await listSupersetFiles(
          workspaceId,
          worktreeId,
          signal,
        );
        if (signal?.aborted || requestId !== listRequestId.current) return;
        setFiles(nextFiles);
        if (selectFirst && !openFileRef.current && nextFiles.length > 0) {
          const preferred =
            nextFiles.find(
              (file) =>
                file.kind === "file" &&
                file.size <= 2 * 1024 * 1024 &&
                /\.(tsx?|jsx?|py|rs|md|json|css|html)$/i.test(file.path),
            ) ??
            nextFiles.find(
              (file) => file.kind === "file" && file.size <= 2 * 1024 * 1024,
            );
          if (preferred) void openPath(preferred.path, signal);
        }
        if (!quiet)
          setNotice((current) =>
            current?.kind === "error" && !openFileRef.current ? null : current,
          );
      } catch (error) {
        if (!signal?.aborted && requestId === listRequestId.current) {
          setNotice({
            kind: "error",
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

  useEffect(() => {
    const controller = new AbortController();
    // The client API request starts here after the authenticated page mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshFiles(true, false, controller.signal);
    return () => controller.abort();
  }, [refreshFiles]);

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
    setActionEntry(null);
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
    setActionEntry(null);
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
    setActionEntry(null);
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

  function selectFile(path: string) {
    if (savingRef.current || openingPath || path === openFileRef.current?.path)
      return;
    const current = openFileRef.current;
    if (
      current &&
      contentsRef.current !== current.contents &&
      !window.confirm("Discard your unsaved changes and open another file?")
    )
      return;
    void openPath(path);
  }

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
    return (
      <>
        {children.map((child) => {
          const expanded =
            Boolean(query.trim()) || expandedFolders.has(child.path);
          return (
            <li role="none" key={child.path}>
              <div className="gen2-superset-tree-row">
                <button
                  type="button"
                  className="gen2-superset-folder"
                  role="treeitem"
                  aria-expanded={expanded}
                  aria-level={level}
                  aria-selected={false}
                  title={child.path}
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
                    size={14}
                    className={
                      expanded ? undefined : "gen2-superset-chevron-closed"
                    }
                  />
                  <Folder aria-hidden="true" size={15} />
                  <span className="gen2-superset-tree-label">{child.name}</span>
                </button>
                {canEdit ? (
                  <button
                    type="button"
                    className="gen2-superset-tree-action"
                    aria-label={`Actions for ${child.path}`}
                    aria-expanded={actionEntry?.path === child.path}
                    title={`Actions for ${child.path}`}
                    disabled={creating || renaming || deleting}
                    onClick={() =>
                      setActionEntry((current) =>
                        current?.path === child.path
                          ? null
                          : { path: child.path, kind: "directory" },
                      )
                    }
                  >
                    <MoreHorizontal aria-hidden="true" size={15} />
                  </button>
                ) : null}
              </div>
              {actionEntry?.path === child.path ? (
                <div
                  className="gen2-superset-entry-actions"
                  aria-label={`Actions for ${child.path}`}
                >
                  <button
                    type="button"
                    onClick={() => startCreate("file", child.path)}
                  >
                    <FilePlus aria-hidden="true" size={13} /> New file
                  </button>
                  <button
                    type="button"
                    onClick={() => startCreate("directory", child.path)}
                  >
                    <FolderPlus aria-hidden="true" size={13} /> New folder
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      startRename({ path: child.path, kind: "directory" })
                    }
                  >
                    <Pencil aria-hidden="true" size={13} /> Rename
                  </button>
                  <button
                    type="button"
                    className="gen2-superset-destructive"
                    onClick={() =>
                      requestDelete({ path: child.path, kind: "directory" })
                    }
                  >
                    <Trash2 aria-hidden="true" size={13} /> Delete
                  </button>
                </div>
              ) : null}
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
              <div className="gen2-superset-tree-row">
                <button
                  type="button"
                  role="treeitem"
                  aria-level={level}
                  aria-selected={selected}
                  aria-current={selected ? "page" : undefined}
                  className="gen2-superset-file"
                  title={file.path}
                  disabled={saving}
                  onClick={() => selectFile(file.path)}
                >
                  <FileCode2 aria-hidden="true" size={15} />
                  <span className="gen2-superset-tree-label">
                    {fileName(file.path)}
                  </span>
                  {selected && dirty ? (
                    <span
                      className="gen2-superset-dirty"
                      aria-label="Unsaved changes"
                    />
                  ) : null}
                </button>
                {canEdit ? (
                  <button
                    type="button"
                    className="gen2-superset-tree-action"
                    aria-label={`Actions for ${file.path}`}
                    aria-expanded={actionEntry?.path === file.path}
                    title={`Actions for ${file.path}`}
                    disabled={creating || renaming || deleting}
                    onClick={() =>
                      setActionEntry((current) =>
                        current?.path === file.path ? null : file,
                      )
                    }
                  >
                    <MoreHorizontal aria-hidden="true" size={15} />
                  </button>
                ) : null}
              </div>
              {actionEntry?.path === file.path ? (
                <div
                  className="gen2-superset-entry-actions"
                  aria-label={`Actions for ${file.path}`}
                >
                  <button type="button" onClick={() => startRename(file)}>
                    <Pencil aria-hidden="true" size={13} /> Rename
                  </button>
                  <button
                    type="button"
                    className="gen2-superset-destructive"
                    onClick={() => requestDelete(file)}
                  >
                    <Trash2 aria-hidden="true" size={13} /> Delete
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </>
    );
  }

  return (
    <main className="gen2-superset-file-pane" aria-label="Superset file pane">
      <header className="gen2-superset-tab-strip">
        {openFile ? (
          <div
            className="gen2-superset-tab"
            aria-label={`Open file: ${fileName(openFile.path)}`}
          >
            <FileCode2 aria-hidden="true" size={14} />
            <span>{fileName(openFile.path)}</span>
            {dirty ? (
              <span
                className="gen2-superset-dirty"
                aria-label="Unsaved changes"
              />
            ) : null}
          </div>
        ) : null}
      </header>
      <aside className="gen2-superset-file-list" aria-label="Files">
        <header className="gen2-superset-files-header">
          <label className="gen2-superset-search">
            <Search aria-hidden="true" size={14} />
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
            <button
              type="button"
              className="gen2-superset-icon-button"
              aria-label="New file"
              title="New file"
              disabled={!canEdit || creating}
              onClick={() => startCreate("file")}
            >
              <FilePlus aria-hidden="true" size={14} />
            </button>
            <button
              type="button"
              className="gen2-superset-icon-button"
              aria-label="New folder"
              title="New folder"
              disabled={!canEdit || creating}
              onClick={() => startCreate("directory")}
            >
              <FolderPlus aria-hidden="true" size={14} />
            </button>
            <button
              type="button"
              className="gen2-superset-icon-button"
              aria-label="Refresh files"
              title="Refresh files"
              disabled={loadingFiles}
              onClick={() => void refreshFiles(true)}
            >
              <RefreshCw aria-hidden="true" size={14} />
            </button>
          </div>
        </header>
        {createKind ? (
          <form className="gen2-superset-create-entry" onSubmit={createEntry}>
            <label>
              <span>
                {createKind === "file" ? "New file name" : "New folder name"}
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
              <button
                type="button"
                disabled={creating}
                onClick={() => {
                  setCreateKind(null);
                  setCreateParentPath("");
                }}
              >
                Cancel
              </button>
              <button type="submit" disabled={!createName.trim() || creating}>
                {creating ? "Creating…" : "Create"}
              </button>
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
              <button
                type="button"
                disabled={renaming}
                onClick={() => {
                  setRenameEntry(null);
                  setRenameName("");
                }}
              >
                Cancel
              </button>
              <button type="submit" disabled={!renameName.trim() || renaming}>
                {renaming ? "Renaming…" : "Rename"}
              </button>
            </div>
          </form>
        ) : null}
        {loadingFiles ? (
          <p className="gen2-superset-list-state" role="status">
            Loading files…
          </p>
        ) : visibleFiles.length === 0 ? (
          <p className="gen2-superset-list-state">
            {query
              ? "No files match your search."
              : "No files found. Refresh to try again."}
          </p>
        ) : (
          <ul role="tree" aria-label="Workspace files">
            {renderTree(tree, 1)}
          </ul>
        )}
      </aside>

      <section
        className="gen2-superset-editor"
        aria-label="Code editor"
        aria-busy={Boolean(openingPath)}
      >
        <header className="gen2-superset-editor-bar">
          <span className="gen2-superset-path" title={openFile?.path}>
            {openFile?.path ?? "No file open"}
          </span>
          <div className="gen2-superset-editor-actions">
            {openFile && !canEdit ? (
              <span className="gen2-superset-read-only">Read only</span>
            ) : null}
            {openFile ? (
              <span
                className="gen2-superset-collaboration-state"
                role="status"
                aria-live="polite"
              >
                {sharedDocument.state === "connected"
                  ? sharedDocument.members.length > 1
                    ? `${sharedDocument.members.length - 1} collaborator${sharedDocument.members.length === 2 ? "" : "s"} editing`
                    : "Shared editing"
                  : sharedDocument.state === "conflict"
                    ? "Resolve conflict"
                    : "Syncing collaboration…"}
              </span>
            ) : null}
            <button
              type="button"
              className="gen2-superset-save"
              disabled={
                !canEdit ||
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
            </button>
            <button
              type="button"
              className="gen2-superset-icon-button"
              onClick={() => openFile && void copyText(openFile.path, "Path")}
              aria-label="Copy path"
              title={copied ? "Copied" : "Copy path"}
              disabled={!openFile}
            >
              {copied ? (
                <Check aria-hidden="true" size={14} />
              ) : (
                <Copy aria-hidden="true" size={14} />
              )}
            </button>
          </div>
        </header>
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
                <button
                  type="button"
                  onClick={() => void copyText(contentsRef.current, "Changes")}
                >
                  Copy changes
                </button>
                <button type="button" onClick={reloadLatest}>
                  Reload latest
                </button>
              </span>
            ) : null}
            {notice.kind === "error" && !openFile ? (
              <button type="button" onClick={() => void refreshFiles(true)}>
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
        {sharedDocument.notice ? (
          <div
            className="gen2-superset-notice gen2-superset-notice-info"
            role={sharedDocument.state === "conflict" ? "alert" : "status"}
            aria-live="polite"
          >
            <span>{sharedDocument.notice}</span>
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
            readOnly={!canEdit || sharedDocument.readOnly}
            onChange={(next) => {
              contentsRef.current = next;
              setContents(next);
              if (!stale) setNotice(null);
            }}
            onSelectionChange={sharedDocument.updateCursor}
            onSave={() => void save()}
          />
        ) : (
          <p className="gen2-superset-empty-state">Select a file to open it.</p>
        )}
      </section>
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
            <h2 id="gen2-superset-delete-title">Delete {deleteEntry.kind}?</h2>
            <p id="gen2-superset-delete-description">
              Delete <strong>{deleteEntry.path}</strong> permanently?
              {deleteEntry.kind === "directory"
                ? " Every file and folder inside it will be deleted too."
                : " This cannot be undone from this workspace."}
            </p>
            <div className="gen2-superset-dialog-actions">
              <button
                type="button"
                autoFocus
                disabled={deleting}
                onClick={() => setDeleteEntry(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="gen2-superset-dialog-delete"
                disabled={deleting}
                onClick={() => void confirmDelete()}
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
