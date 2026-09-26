"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Gen2SupersetFile, Gen2SupersetFileEntry } from "@codev/contracts";
import {
  Check,
  ChevronDown,
  Copy,
  FileCode2,
  FilePlus,
  Folder,
  FolderPlus,
  RefreshCw,
  Search,
} from "lucide-react";

import {
  listSupersetFileChanges,
  listSupersetFiles,
  readSupersetFile,
  saveSupersetFile,
  SupersetFileApiError,
} from "./superset-file-client";

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

function buildFileTree(files: Gen2SupersetFileEntry[]): FileTree {
  const root: FileTree = { name: "", path: "", folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let folder = root;
    for (const name of parts.slice(0, -1)) {
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
    folder.files.push(file);
  }
  return root;
}

function fileName(path: string) {
  return path.split("/").at(-1) ?? path;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof SupersetFileApiError ? error.message : fallback;
}

/** Browser adaptation of Superset's FilePane backed by CoDev's Gen 2 file API. */
export function SupersetFilePane({
  workspaceId,
  canEdit,
}: {
  workspaceId: string;
  canEdit: boolean;
}) {
  const [files, setFiles] = useState<Gen2SupersetFileEntry[]>([]);
  const [openFile, setOpenFile] = useState<Gen2SupersetFile | null>(null);
  const [contents, setContents] = useState("");
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const openFileRef = useRef(openFile);
  const contentsRef = useRef(contents);
  const savingRef = useRef(false);
  const openRequestId = useRef(0);
  const listRequestId = useRef(0);
  const dirty = openFile !== null && contents !== openFile.contents;

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

  const openPath = useCallback(
    async (path: string, signal?: AbortSignal) => {
      const requestId = ++openRequestId.current;
      setOpeningPath(path);
      try {
        const file = await readSupersetFile(workspaceId, path, signal);
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
    [workspaceId],
  );

  const refreshFiles = useCallback(
    async (selectFirst = false, quiet = false, signal?: AbortSignal) => {
      const requestId = ++listRequestId.current;
      if (!quiet) setLoadingFiles(true);
      try {
        const nextFiles = await listSupersetFiles(workspaceId, signal);
        if (signal?.aborted || requestId !== listRequestId.current) return;
        setFiles(nextFiles);
        if (selectFirst && !openFileRef.current && nextFiles.length > 0) {
          const preferred =
            nextFiles.find(
              (file) =>
                file.size <= 2 * 1024 * 1024 &&
                /\.(tsx?|jsx?|py|rs|md|json|css|html)$/i.test(file.path),
            ) ?? nextFiles.find((file) => file.size <= 2 * 1024 * 1024);
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
    [workspaceId, openPath],
  );

  useEffect(() => {
    const controller = new AbortController();
    // The client API request starts here after the authenticated page mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshFiles(true, false, controller.signal);
    return () => controller.abort();
  }, [refreshFiles]);

  const reconcileRemote = useCallback((remote: Gen2SupersetFile) => {
    const current = openFileRef.current;
    if (
      !current ||
      current.path !== remote.path ||
      current.revision === remote.revision
    )
      return;
    if (contentsRef.current !== current.contents || savingRef.current) {
      setStale(true);
      setNotice({
        kind: "conflict",
        text: "This file changed elsewhere while you were editing. Your changes are still here.",
      });
    } else {
      openFileRef.current = remote;
      contentsRef.current = remote.contents;
      setOpenFile(remote);
      setContents(remote.contents);
      setStale(false);
      setNotice({ kind: "info", text: "File updated from the workspace." });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const changes = await listSupersetFileChanges(
          workspaceId,
          controller.signal,
        );
        if (controller.signal.aborted || changes.length === 0) return;
        void refreshFiles(false, true, controller.signal);
        const current = openFileRef.current;
        const changed = changes.find((change) => change.path === current?.path);
        if (!current || !changed || changed.revision === current.revision)
          return;
        if (contentsRef.current !== current.contents || savingRef.current) {
          setStale(true);
          setNotice({
            kind: "conflict",
            text: "This file changed elsewhere while you were editing. Your changes are still here.",
          });
        } else {
          const remote = await readSupersetFile(
            workspaceId,
            current.path,
            controller.signal,
          );
          if (!controller.signal.aborted) reconcileRemote(remote);
        }
      } catch {
        // Revision checking still protects saves; the next poll retries.
      } finally {
        polling = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 10_000);
    // The host event journal is shared by callers. Rechecking the open file
    // also catches a change consumed by another member's browser.
    const verifyTimer = window.setInterval(() => {
      const current = openFileRef.current;
      if (!current || polling) return;
      void readSupersetFile(workspaceId, current.path, controller.signal)
        .then((remote) => {
          if (!controller.signal.aborted) reconcileRemote(remote);
        })
        .catch(() => {});
    }, 30_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.clearInterval(verifyTimer);
    };
  }, [workspaceId, refreshFiles, reconcileRemote]);

  async function save() {
    const file = openFileRef.current;
    const draft = contentsRef.current;
    if (!canEdit || !file || draft === file.contents || savingRef.current)
      return;
    if (stale) {
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
      const saved = await saveSupersetFile(workspaceId, file, draft);
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
    ? files.filter((file) =>
        file.path.toLowerCase().includes(query.trim().toLowerCase()),
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
            <UnavailableAction icon={FilePlus} label="New file" />
            <UnavailableAction icon={FolderPlus} label="New folder" />
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
            <button
              type="button"
              className="gen2-superset-save"
              disabled={
                !canEdit || !dirty || saving || Boolean(openingPath) || stale
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
        {openingPath ? (
          <p className="gen2-superset-empty-state" role="status">
            Opening {fileName(openingPath)}…
          </p>
        ) : openFile ? (
          <SupersetCodeEditor
            key={openFile.path}
            path={openFile.path}
            value={contents}
            readOnly={!canEdit}
            onChange={(next) => {
              contentsRef.current = next;
              setContents(next);
              if (!stale) setNotice(null);
            }}
            onSave={() => void save()}
          />
        ) : (
          <p className="gen2-superset-empty-state">Select a file to open it.</p>
        )}
      </section>
    </main>
  );
}

function UnavailableAction({
  icon: Icon,
  label,
}: {
  icon: typeof FilePlus;
  label: string;
}) {
  return (
    <button
      type="button"
      className="gen2-superset-icon-button"
      aria-label={label}
      title={`${label} is coming soon`}
      disabled
    >
      <Icon aria-hidden="true" size={14} />
    </button>
  );
}
