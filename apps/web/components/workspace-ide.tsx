"use client";

import { DiffEditor, Editor, type OnMount } from "@monaco-editor/react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { editor as MonacoEditor } from "monaco-editor";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type CollaborationConflict,
  type CollaborationStatus,
  type CollaborationUser,
  WorkspaceCollaboration,
} from "@/lib/collaboration-client";
import {
  languageForPath,
  type SearchMatch,
  type WorkspaceFile,
} from "@/lib/ide";
import { formatPresenceCopy } from "@/lib/presence-copy";
import {
  isPreviewExtensionAllowed,
  resolvePreviewEntry,
} from "@/lib/preview";
import { AgentPanel } from "@/components/agent-panel";
import { PreviewPane } from "@/components/preview-pane";
import { WorkspaceShareButton } from "@/components/workspace-share-button";

type IdeView = "chat" | "files" | "code" | "preview" | "terminal";

interface OpenFile {
  path: string;
  contents: string;
  savedContents: string;
  original: string;
  revision: string;
  dirty: boolean;
}

async function payload<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(
      body?.error ?? `Request failed with HTTP ${response.status}.`,
    );
  }
  return body as T;
}

function fileName(path: string) {
  return path.split("/").at(-1) ?? path;
}

function collaboratorLabel(collaborator: CollaborationUser) {
  return collaborator.name ?? collaborator.login;
}

export interface WorkspaceIdeProps {
  workspaceId: string;
  repository: string;
  branch: string;
  canTerminal: boolean;
  canMerge: boolean;
  isOwner: boolean;
  integrationHeadSha: string;
  user: {
    id: string;
    name?: string | null;
    login?: string;
    image?: string | null;
  };
}

export function WorkspaceIde({
  workspaceId,
  repository,
  branch,
  canTerminal,
  canMerge,
  isOwner,
  integrationHeadSha,
  user,
}: WorkspaceIdeProps) {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [view, setView] = useState<IdeView>("chat");
  const [terminalCollapsed, setTerminalCollapsed] = useState(true);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [collaborationStatus, setCollaborationStatus] =
    useState<CollaborationStatus>("connecting");
  const [collaborators, setCollaborators] = useState<CollaborationUser[]>([]);
  const [collaborationConflict, setCollaborationConflict] =
    useState<CollaborationConflict | null>(null);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [publicationBranch, setPublicationBranch] = useState("codev/demo");
  const [publishing, setPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [openingPullRequest, setOpeningPullRequest] = useState(false);
  const [pullRequestUrl, setPullRequestUrl] = useState<string | null>(null);
  const collaboration = useRef<WorkspaceCollaboration | null>(null);
  const editor = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const saveRef = useRef<() => Promise<void>>(async () => undefined);
  const terminalElement = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const terminalSession = useRef<string | null>(null);
  const terminalInput = useRef("");
  const terminalInputTimer = useRef<number | null>(null);
  const terminalSendChain = useRef<Promise<void>>(Promise.resolve());
  const previewRefreshTimer = useRef<number | null>(null);
  const [previewRevision, setPreviewRevision] = useState(0);

  const apiBase = `/api/workspaces/${workspaceId}/sandbox`;

  async function publishBranch() {
    setPublishing(true);
    setError("");
    try {
      const result = await fetch(
        `/api/workspaces/${workspaceId}/publications`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            branchName: publicationBranch,
            expectedHeadSha: integrationHeadSha,
          }),
        },
      ).then((response) =>
        payload<{ publication: { htmlUrl: string | null } }>(response),
      );
      setPublishedUrl(result.publication.htmlUrl);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Publication failed.",
      );
    } finally {
      setPublishing(false);
    }
  }

  async function openPullRequest() {
    setOpeningPullRequest(true);
    setError("");
    try {
      const result = await fetch(
        `/api/workspaces/${workspaceId}/pull-requests`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            branchName: publicationBranch,
            title: `CoDev: ${publicationBranch}`,
          }),
        },
      ).then((response) =>
        payload<{ pullRequest: { htmlUrl: string } }>(response),
      );
      setPullRequestUrl(result.pullRequest.htmlUrl);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Opening the pull request failed.",
      );
    } finally {
      setOpeningPullRequest(false);
    }
  }

  const refreshFiles = useCallback(async () => {
    const filePayload = await fetch(`${apiBase}/files`, {
      cache: "no-store",
    }).then((response) => payload<{ files: WorkspaceFile[] }>(response));
    setFiles(filePayload.files);
  }, [apiBase]);

  const refreshPreviewNow = useCallback(() => {
    if (previewRefreshTimer.current !== null) {
      window.clearTimeout(previewRefreshTimer.current);
      previewRefreshTimer.current = null;
    }
    setPreviewRevision((current) => current + 1);
    void refreshFiles().catch(() => undefined);
  }, [refreshFiles]);

  const schedulePreviewRefresh = useCallback(() => {
    if (previewRefreshTimer.current !== null) {
      window.clearTimeout(previewRefreshTimer.current);
    }
    previewRefreshTimer.current = window.setTimeout(() => {
      previewRefreshTimer.current = null;
      setPreviewRevision((current) => current + 1);
      void refreshFiles().catch(() => undefined);
    }, 2_000);
  }, [refreshFiles]);

  useEffect(() => {
    return () => {
      if (previewRefreshTimer.current !== null) {
        window.clearTimeout(previewRefreshTimer.current);
      }
    };
  }, []);

  const hasPreview = useMemo(
    () => Boolean(resolvePreviewEntry(files.map((file) => file.path))),
    [files],
  );

  useEffect(() => {
    if (!hasPreview && view === "preview") {
      setView("chat");
    }
  }, [hasPreview, view]);

  useEffect(() => {
    const client = new WorkspaceCollaboration(
      workspaceId,
      {
        id: user.id,
        login: user.login ?? user.name ?? "GitHub user",
        name: user.name ?? null,
        image: user.image ?? null,
      },
      {
        onStatus: setCollaborationStatus,
        onPresence: setCollaborators,
        onConflict: setCollaborationConflict,
        onDocument: (path, contents, synced) => {
          setOpenFile((current) =>
            current?.path === path
              ? {
                  ...current,
                  contents,
                  dirty: synced && contents !== current.savedContents,
                }
              : current,
          );
        },
        onReconciled: (path, revision, contents) => {
          setOpenFile((current) =>
            current?.path === path
              ? {
                  ...current,
                  contents,
                  savedContents: contents,
                  revision,
                  dirty: false,
                }
              : current,
          );
          void refreshFiles().catch(() => undefined);
        },
        onError: setError,
      },
    );
    collaboration.current = client;
    client.connect();
    return () => {
      client.destroy();
      collaboration.current = null;
    };
  }, [refreshFiles, user.id, user.image, user.login, user.name, workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshFiles()
        .catch((caught) =>
          setError(
            caught instanceof Error ? caught.message : "Could not load files.",
          ),
        )
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshFiles]);

  const writeTerminal = useCallback(async (value: string) => {
    const instance = terminal.current;
    if (!instance) return;
    for (let offset = 0; offset < value.length; offset += 16_384) {
      const chunk = value.slice(offset, offset + 16_384);
      await new Promise<void>((resolve) => instance.write(chunk, resolve));
    }
  }, []);

  useEffect(() => {
    if (!canTerminal || !terminalElement.current || terminal.current) return;
    let stopped = false;
    let pollTimer: number | null = null;
    let resizeTimer: number | null = null;
    let acknowledged = 0;
    const instance = new Terminal({
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "var(--font-geist-mono), monospace",
      fontSize: 12,
      theme: {
        background: "#081221",
        foreground: "#b9c1be",
        cursor: "#d4af37",
        cyan: "#d4af37",
        blue: "#64b7d0",
        red: "#ef8e8e",
        green: "#79cea9",
      },
    });
    const fit = new FitAddon();
    instance.loadAddon(fit);
    instance.open(terminalElement.current);
    fit.fit();
    instance.writeln("\x1b[33mConnecting to the Firecracker PTY…\x1b[0m");

    async function flushInput() {
      terminalInputTimer.current = null;
      const sessionId = terminalSession.current;
      const data = terminalInput.current;
      terminalInput.current = "";
      if (!sessionId || !data || stopped) return;
      terminalSendChain.current = terminalSendChain.current
        .then(async () => {
          await fetch(`${apiBase}/terminal`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "input", sessionId, data }),
          }).then((response) => payload<Record<string, never>>(response));
        })
        .catch(async (caught) => {
          await writeTerminal(
            `\r\n\x1b[31m${caught instanceof Error ? caught.message : "Terminal input failed."}\x1b[0m\r\n`,
          );
        });
      await terminalSendChain.current;
    }

    function queueInput(data: string) {
      terminalInput.current += data;
      if (terminalInputTimer.current === null) {
        terminalInputTimer.current = window.setTimeout(() => {
          void flushInput();
        }, 20);
      }
    }

    async function poll(sessionId: string) {
      if (stopped) return;
      try {
        const response = await fetch(`${apiBase}/terminal`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "poll",
            sessionId,
            after: acknowledged,
          }),
        }).then((result) =>
          payload<{
            result: {
              chunks: { sequence: number; data: string }[];
              exited: boolean;
              exitCode: number | null;
            };
          }>(result),
        );
        for (const chunk of response.result.chunks) {
          await writeTerminal(chunk.data);
          acknowledged = Math.max(acknowledged, chunk.sequence);
        }
        if (response.result.exited) {
          await writeTerminal(
            `\r\n\x1b[33mPTY exited (${response.result.exitCode ?? "unknown"}). Reload to reconnect.\x1b[0m\r\n`,
          );
          return;
        }
      } catch (caught) {
        await writeTerminal(
          `\r\n\x1b[31m${caught instanceof Error ? caught.message : "Terminal stream interrupted."}\x1b[0m\r\n`,
        );
      }
      if (!stopped)
        pollTimer = window.setTimeout(() => void poll(sessionId), 0);
    }

    async function connect() {
      try {
        const result = await fetch(`${apiBase}/terminal`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "start",
            rows: instance.rows,
            columns: instance.cols,
          }),
        }).then((response) => payload<{ sessionId: string }>(response));
        if (stopped) return;
        terminalSession.current = result.sessionId;
        instance.clear();
        void poll(result.sessionId);
      } catch (caught) {
        await writeTerminal(
          `\x1b[31m${caught instanceof Error ? caught.message : "Could not start terminal."}\x1b[0m\r\n`,
        );
      }
    }

    const dataSubscription = instance.onData(queueInput);
    const observer = new ResizeObserver(() => {
      fit.fit();
      const sessionId = terminalSession.current;
      if (!sessionId) return;
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        void fetch(`${apiBase}/terminal`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "resize",
            sessionId,
            rows: instance.rows,
            columns: instance.cols,
          }),
        });
      }, 100);
    });
    observer.observe(terminalElement.current);
    terminal.current = instance;
    fitAddon.current = fit;
    void connect();
    return () => {
      stopped = true;
      observer.disconnect();
      dataSubscription.dispose();
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      if (terminalInputTimer.current !== null) {
        window.clearTimeout(terminalInputTimer.current);
      }
      const sessionId = terminalSession.current;
      if (sessionId) {
        void fetch(
          `${apiBase}/terminal?sessionId=${encodeURIComponent(sessionId)}`,
          { method: "DELETE", keepalive: true },
        );
      }
      instance.dispose();
      terminal.current = null;
      fitAddon.current = null;
      terminalSession.current = null;
    };
  }, [apiBase, canTerminal, writeTerminal]);

  useEffect(() => {
    if (view !== "terminal" || terminalCollapsed) return;
    const frame = window.requestAnimationFrame(() => {
      fitAddon.current?.fit();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [terminalCollapsed, view]);

  async function openPath(path: string, line?: number) {
    if (openFile?.path === path) return;
    setError("");
    try {
      const [fileResult, headResult] = await Promise.all([
        fetch(`${apiBase}/files`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path }),
        }).then((response) =>
          payload<{
            file: { path: string; contents: string; revision: string };
          }>(response),
        ),
        fetch(
          `${apiBase}/git?operation=show&path=${encodeURIComponent(path)}`,
          { cache: "no-store" },
        ).then((response) => payload<{ contents: string }>(response)),
      ]);
      setOpenFile({
        ...fileResult.file,
        savedContents: fileResult.file.contents,
        original: headResult.contents,
        dirty: false,
      });
      setDiffOpen(false);
      if (line) {
        window.setTimeout(() => {
          document
            .querySelector(`[data-line="${line}"]`)
            ?.scrollIntoView({ block: "center" });
        }, 0);
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not open file.",
      );
    }
  }

  async function resolveCollaborationConflict(
    strategy: "collaboration" | "filesystem",
  ) {
    if (!collaborationConflict) return;
    setResolvingConflict(true);
    setError("");
    try {
      const result = await fetch(
        `/api/workspaces/${workspaceId}/collaboration/conflicts/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            path: collaborationConflict.path,
            strategy,
            expectedSnapshotRevision: collaborationConflict.snapshotRevision,
            expectedFilesystemRevision:
              collaborationConflict.filesystemRevision,
          }),
        },
      ).then((response) =>
        payload<{ revision: string; strategy: string }>(response),
      );
      if (
        strategy === "filesystem" &&
        openFile?.path === collaborationConflict.path
      ) {
        const latest = await fetch(`${apiBase}/files`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: collaborationConflict.path }),
        }).then((response) =>
          payload<{
            file: { path: string; contents: string; revision: string };
          }>(response),
        );
        setOpenFile({
          path: latest.file.path,
          contents: latest.file.contents,
          savedContents: latest.file.contents,
          original: latest.file.contents,
          revision: latest.file.revision,
          dirty: false,
        });
      } else if (openFile?.path === collaborationConflict.path) {
        setOpenFile((current) =>
          current
            ? {
                ...current,
                revision: result.revision,
                savedContents: current.contents,
                dirty: false,
              }
            : null,
        );
      }
      setCollaborationConflict(null);
      await refreshFiles();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Conflict resolution failed.",
      );
    } finally {
      setResolvingConflict(false);
    }
  }

  const save = useCallback(async () => {
    if (!openFile?.dirty || saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await fetch(`${apiBase}/files`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: openFile.path,
          contents: openFile.contents,
          expectedRevision: openFile.revision,
        }),
      }).then((response) => payload<{ revision: string }>(response));
      setOpenFile((current) =>
        current
          ? {
              ...current,
              revision: result.revision,
              savedContents: current.contents,
              dirty: false,
            }
          : null,
      );
      await refreshFiles();
      if (isPreviewExtensionAllowed(openFile.path)) {
        schedulePreviewRefresh();
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save file.",
      );
    } finally {
      setSaving(false);
    }
  }, [apiBase, openFile, refreshFiles, saving, schedulePreviewRefresh]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const editorMount: OnMount = useCallback(
    (instance, monaco) => {
      editor.current = instance;
      instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void saveRef.current();
      });
      if (openFile) {
        collaboration.current?.openDocument(openFile.path, instance);
      }
    },
    [openFile],
  );

  useEffect(() => {
    const path = openFile?.path;
    if (diffOpen) {
      collaboration.current?.closeDocument();
      return;
    }
    if (!path || !editor.current) return;
    collaboration.current?.openDocument(path, editor.current);
  }, [diffOpen, openFile?.path]);

  useEffect(() => {
    if (!query.trim()) return;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void fetch(`${apiBase}/files?query=${encodeURIComponent(query.trim())}`, {
        cache: "no-store",
      })
        .then((response) => payload<{ matches: SearchMatch[] }>(response))
        .then((result) => setMatches(result.matches))
        .catch((caught) =>
          setError(caught instanceof Error ? caught.message : "Search failed."),
        )
        .finally(() => setSearching(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [apiBase, query]);

  const distinctCollaborators = useMemo(
    () => [
      ...new Map(collaborators.map((member) => [member.id, member])).values(),
    ],
    [collaborators],
  );
  const presenceByPath = useMemo(() => {
    const paths = new Map<string, CollaborationUser[]>();
    for (const member of distinctCollaborators) {
      if (!member.activePath) continue;
      paths.set(member.activePath, [
        ...(paths.get(member.activePath) ?? []),
        member,
      ]);
    }
    return paths;
  }, [distinctCollaborators]);

  return (
    <main className="live-ide" aria-label="CoDev browser IDE">
      <header className="live-ide-topbar">
        <Link className="workspace-brand" href={`/workspaces/${workspaceId}`}>
          <span
            className="wordmark-mark workspace-brand-mark"
            aria-hidden="true"
          >
            <span />
            <span />
          </span>
          <strong>CoDev</strong>
        </Link>
        <span className="topbar-divider" />
        <div className="repo-crumbs">
          <span className="github-glyph">⑂</span>
          <strong>{repository}</strong>
          <i>/</i>
          <span>{openFile ? fileName(openFile.path) : "workspace"}</span>
        </div>
        <div className="topbar-center">
          <span className="branch-icon">⑂</span>
          <span>{branch}</span>
        </div>
        <div className="topbar-actions">
          <WorkspaceShareButton workspaceId={workspaceId} isOwner={isOwner} />
          <span
            className={`connection-state collaboration-${collaborationStatus}`}
          >
            <i />{" "}
            {collaborationStatus === "online"
              ? "Realtime online"
              : collaborationStatus === "reconnecting"
                ? "Reconnecting…"
                : collaborationStatus === "connecting"
                  ? "Connecting…"
                  : "Realtime offline"}
          </span>
          <div
            className="presence-group"
            aria-label={formatPresenceCopy(distinctCollaborators.length)}
          >
            <span className="presence-copy">
              {formatPresenceCopy(distinctCollaborators.length)}
            </span>
            <div className="presence-stack">
              {distinctCollaborators.slice(0, 4).map((collaborator) =>
                collaborator.image ? (
                  <Image
                    key={collaborator.id}
                    src={collaborator.image}
                    alt={collaboratorLabel(collaborator)}
                    title={collaboratorLabel(collaborator)}
                    width={26}
                    height={26}
                    unoptimized
                  />
                ) : (
                  <span
                    key={collaborator.id}
                    title={collaboratorLabel(collaborator)}
                    style={
                      {
                        "--presence-color": collaborator.color,
                      } as React.CSSProperties
                    }
                  >
                    {collaborator.login.slice(0, 1).toUpperCase()}
                  </span>
                ),
              )}
            </div>
          </div>
          {user.image ? (
            <Image src={user.image} alt="" width={26} height={26} unoptimized />
          ) : (
            <span className="user-avatar">
              {(user.login ?? user.name ?? "U").slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
      </header>

      <div
        className={[
          "live-ide-grid",
          `view-${view}`,
          hasPreview ? "has-preview" : "preview-hidden",
          view === "terminal" && terminalCollapsed ? "terminal-collapsed" : "",
          view === "terminal" && !terminalCollapsed ? "terminal-open" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <aside className="activity-rail" aria-label="IDE views">
          <button
            className={`rail-button agent-rail ${view === "chat" ? "active" : ""}`}
            type="button"
            aria-label="Chat"
            aria-pressed={view === "chat"}
            onClick={() => {
              setView("chat");
              setTerminalCollapsed(true);
            }}
          >
            ✦
          </button>
          <button
            className={`rail-button ${view === "files" ? "active" : ""}`}
            type="button"
            aria-label="Files"
            aria-pressed={view === "files"}
            onClick={() => {
              setView("files");
              setSearchOpen(false);
              setTerminalCollapsed(true);
            }}
          >
            ◫
          </button>
          <button
            className={`rail-button ${view === "code" ? "active" : ""}`}
            type="button"
            aria-label="Code"
            aria-pressed={view === "code"}
            onClick={() => {
              setView("code");
              setTerminalCollapsed(true);
            }}
          >
            ⌘
          </button>
          {hasPreview ? (
            <button
              className={`rail-button ${view === "preview" ? "active" : ""}`}
              type="button"
              aria-label="Preview focus"
              aria-pressed={view === "preview"}
              onClick={() => {
                setView("preview");
                setTerminalCollapsed(true);
              }}
            >
              ▣
            </button>
          ) : null}
          <button
            className={`rail-button ${view === "terminal" ? "active" : ""}`}
            type="button"
            aria-label="Terminal"
            aria-pressed={view === "terminal"}
            onClick={() => {
              setView("terminal");
              setTerminalCollapsed(false);
            }}
          >
            ▹
          </button>
          <span className="rail-spacer" />
          <Link className="rail-button" href={`/workspaces/${workspaceId}`}>
            ⚙
          </Link>
        </aside>

        <div
          className={[
            "ide-main-stage",
            hasPreview ? "has-preview" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <AgentPanel
            workspaceId={workspaceId}
            canMerge={canMerge}
            onTurnCompleted={schedulePreviewRefresh}
          />
          {hasPreview ? (
            <PreviewPane
              workspaceId={workspaceId}
              files={files}
              revisionToken={String(previewRevision)}
              onRefresh={refreshPreviewNow}
              className={[
                "preview-pane-enter",
                view === "preview" ? "preview-focus" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              exportActions={
                canMerge ? (
                  <div
                    className="publication-control preview-export-control"
                    aria-label="Share what you built"
                  >
                    {publishedUrl ? (
                      <>
                        <a href={publishedUrl} target="_blank" rel="noreferrer">
                          Published ↗
                        </a>
                        {pullRequestUrl ? (
                          <a
                            href={pullRequestUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Pull request ↗
                          </a>
                        ) : (
                          <button
                            type="button"
                            disabled={openingPullRequest}
                            onClick={() => void openPullRequest()}
                          >
                            {openingPullRequest
                              ? "Opening PR…"
                              : "Open pull request"}
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <input
                          aria-label="GitHub publication branch"
                          value={publicationBranch}
                          onChange={(event) =>
                            setPublicationBranch(
                              event.target.value.toLowerCase(),
                            )
                          }
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          disabled={publishing || openFile?.dirty}
                          onClick={() => void publishBranch()}
                        >
                          {publishing ? "Publishing…" : "Publish"}
                        </button>
                      </>
                    )}
                  </div>
                ) : undefined
              }
            />
          ) : null}

          {view === "files" ? (
            <aside
              className="file-sidebar ide-drawer ide-drawer-files"
              aria-label="Files"
            >
              <div className="panel-title">
                <span>{searchOpen ? "Search" : "Explorer"}</span>
                <div className="ide-drawer-actions">
                  <button
                    type="button"
                    className={searchOpen ? "active" : ""}
                    aria-label="Search"
                    onClick={() => setSearchOpen((open) => !open)}
                  >
                    ⌕
                  </button>
                  <button type="button" onClick={() => void refreshFiles()}>
                    ↻
                  </button>
                  <button
                    type="button"
                    aria-label="Close files"
                    onClick={() => setView("chat")}
                  >
                    ✕
                  </button>
                </div>
              </div>
              {searchOpen ? (
                <>
                  <div className="ide-search">
                    <input
                      aria-label="Search workspace"
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        if (!event.target.value.trim()) setMatches([]);
                      }}
                      placeholder="Search files"
                      autoFocus
                    />
                  </div>
                  <div className="search-results">
                    {searching ? <p>Searching…</p> : null}
                    {matches.map((match) => (
                      <button
                        key={`${match.path}:${match.line}`}
                        type="button"
                        onClick={() => {
                          void openPath(match.path, match.line);
                          setView("code");
                        }}
                      >
                        <strong>{fileName(match.path)}</strong>
                        <span>
                          {match.path}:{match.line}
                        </span>
                        <small>{match.preview}</small>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="repository-heading">
                    <span>⌄</span>
                    <strong>
                      {repository.split("/").at(-1)?.toUpperCase()}
                    </strong>
                  </div>
                  <div className="file-tree">
                    {loading ? (
                      <p className="ide-empty">Loading files…</p>
                    ) : null}
                    {files.map((file) => (
                      <button
                        className={`file-row ${openFile?.path === file.path ? "active" : ""}`}
                        key={file.path}
                        type="button"
                        style={
                          {
                            "--file-depth": file.path.split("/").length - 1,
                          } as React.CSSProperties
                        }
                        onClick={() => {
                          void openPath(file.path);
                          setView("code");
                        }}
                        title={file.path}
                      >
                        <span className="file-kind">◇</span>
                        <span>{fileName(file.path)}</span>
                        {file.status ? <i>{file.status}</i> : null}
                        {(presenceByPath.get(file.path) ?? []).length > 0 ? (
                          <span
                            className="file-presence"
                            aria-label="Active editors"
                          >
                            {(presenceByPath.get(file.path) ?? [])
                              .slice(0, 3)
                              .map((collaborator) => (
                                <b
                                  key={collaborator.id}
                                  title={`${collaboratorLabel(collaborator)} is editing`}
                                  style={
                                    {
                                      "--presence-color": collaborator.color,
                                    } as React.CSSProperties
                                  }
                                />
                              ))}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </aside>
          ) : null}

          {view === "code" ? (
            <section
              className="ide-editor ide-drawer ide-drawer-code"
              aria-label="Code editor"
            >
              <div className="editor-tabbar">
                {openFile ? (
                  <div className="editor-tab active">
                    <span>
                      {openFile.dirty ? "● " : ""}
                      {fileName(openFile.path)}
                    </span>
                  </div>
                ) : null}
                <div className="editor-tab-actions">
                  <button
                    type="button"
                    disabled={!openFile}
                    className={diffOpen ? "active" : ""}
                    onClick={() => setDiffOpen((value) => !value)}
                  >
                    Diff
                  </button>
                  <button
                    type="button"
                    disabled={
                      collaborationStatus === "online" ||
                      !openFile?.dirty ||
                      saving
                    }
                    onClick={() => void save()}
                  >
                    {collaborationStatus === "online"
                      ? openFile?.dirty
                        ? "Syncing…"
                        : "Synced"
                      : saving
                        ? "Saving…"
                        : "Save"}
                  </button>
                  <button
                    type="button"
                    aria-label="Close code"
                    onClick={() => setView("chat")}
                  >
                    ✕
                  </button>
                </div>
              </div>
              {error ? <div className="ide-error">{error}</div> : null}
              {collaborationConflict ? (
                <div className="collaboration-conflict" role="alert">
                  <div>
                    <strong>
                      Filesystem conflict in {collaborationConflict.path}
                    </strong>
                    <span>{collaborationConflict.message}</span>
                  </div>
                  <div className="collaboration-conflict-actions">
                    <button
                      type="button"
                      disabled={resolvingConflict}
                      onClick={() =>
                        void resolveCollaborationConflict("collaboration")
                      }
                    >
                      Keep editor version
                    </button>
                    <button
                      type="button"
                      disabled={resolvingConflict}
                      onClick={() =>
                        void resolveCollaborationConflict("filesystem")
                      }
                    >
                      Use sandbox version
                    </button>
                  </div>
                </div>
              ) : null}
              {openFile ? (
                diffOpen ? (
                  <DiffEditor
                    original={openFile.original}
                    modified={openFile.contents}
                    language={languageForPath(openFile.path)}
                    theme="vs-dark"
                    options={{
                      automaticLayout: true,
                      fontFamily: "var(--font-geist-mono)",
                      fontSize: 13,
                      minimap: { enabled: false },
                      renderSideBySide: true,
                      readOnly: true,
                    }}
                  />
                ) : (
                  <Editor
                    path={openFile.path}
                    value={openFile.contents}
                    language={languageForPath(openFile.path)}
                    theme="vs-dark"
                    onMount={editorMount}
                    onChange={(contents) =>
                      setOpenFile((current) =>
                        current
                          ? {
                              ...current,
                              contents: contents ?? "",
                              dirty: (contents ?? "") !== current.savedContents,
                            }
                          : null,
                      )
                    }
                    options={{
                      automaticLayout: true,
                      fontFamily: "var(--font-geist-mono)",
                      fontSize: 13,
                      minimap: { enabled: false },
                      padding: { top: 14 },
                      smoothScrolling: true,
                      tabSize: 2,
                    }}
                  />
                )
              ) : (
                <div className="ide-welcome">
                  <span className="wordmark-mark" aria-hidden="true">
                    <span />
                    <span />
                  </span>
                  <h1>Open a file to start building.</h1>
                  <p>
                    Use the Files rail to browse the Firecracker workspace, then
                    edit here.
                  </p>
                </div>
              )}
            </section>
          ) : null}
        </div>

        <section
          className={[
            "terminal-panel",
            "live-terminal",
            view === "terminal" ? "terminal-drawer" : "terminal-hidden",
            terminalCollapsed ? "is-collapsed" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label="Sandbox terminal"
          aria-hidden={view !== "terminal"}
        >
          <div className="terminal-head">
            <div>
              <button className="active" type="button">
                Terminal <span>1</span>
              </button>
            </div>
            <div className="terminal-head-actions">
              <span>
                {canTerminal ? "authenticated" : "capability required"}
              </span>
              <button
                type="button"
                aria-label={
                  terminalCollapsed ? "Expand terminal" : "Collapse terminal"
                }
                onClick={() => setTerminalCollapsed((value) => !value)}
              >
                {terminalCollapsed ? "▴" : "▾"}
              </button>
              <button
                type="button"
                aria-label="Close terminal"
                onClick={() => {
                  setView("chat");
                  setTerminalCollapsed(true);
                }}
              >
                ✕
              </button>
            </div>
          </div>
          {canTerminal ? (
            <div className="xterm-host" ref={terminalElement} />
          ) : (
            <div className="terminal-denied">
              Ask the workspace owner for terminal capability.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
