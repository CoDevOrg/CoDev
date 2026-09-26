"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Files,
  GitBranch,
  PanelRightOpen,
  RefreshCw,
  SquareTerminal,
  Upload,
} from "lucide-react";
import type { Gen2File, Gen2FileEntry } from "@codev/contracts";

import { Gen2EditorPane } from "./editor-pane";
import { Gen2FileTree } from "./file-tree";
import { Gen2GitPanel } from "./git-panel";
import { Gen2TerminalPane } from "./terminal-pane";

type Tab = "files" | "terminal" | "git";

const TABS: { id: Tab; label: string; Icon: typeof Files }[] = [
  { id: "files", label: "Files", Icon: Files },
  { id: "terminal", label: "Terminal", Icon: SquareTerminal },
  { id: "git", label: "Git", Icon: GitBranch },
];

const MIN_WIDTH = 360;
const MAX_WIDTH = 900;

export type Gen2WorkbenchHandle = { openFile(path: string): void };

export function Gen2Workbench({
  workspaceId,
  ready,
  agentRunning,
  refreshToken,
  onRefresh,
  onResumeWorkspace,
  handleRef,
}: {
  workspaceId: string;
  ready: boolean;
  agentRunning: boolean;
  refreshToken: number;
  onRefresh: () => void;
  onResumeWorkspace: () => Promise<boolean>;
  handleRef: React.RefObject<Gen2WorkbenchHandle | null>;
}) {
  const [tab, setTab] = useState<Tab>("files");
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(520);
  const [files, setFiles] = useState<Gen2FileEntry[]>([]);
  const [openFile, setOpenFile] = useState<Gen2File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const storageKey = `codev-gen2-workbench:${workspaceId}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        tab?: Tab;
        collapsed?: boolean;
        width?: number;
      };
      // Read after mount, not in a lazy initialiser: localStorage does not
      // exist during the server render, and seeding from it there would be a
      // hydration mismatch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved.tab) setTab(saved.tab);
      if (typeof saved.collapsed === "boolean") setCollapsed(saved.collapsed);
      if (typeof saved.width === "number") setWidth(saved.width);
    } catch {
      /* Preference only. */
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ tab, collapsed, width }),
      );
    } catch {
      /* Preference only. */
    }
  }, [storageKey, tab, collapsed, width]);

  const loadFiles = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/gen2/workspaces/${workspaceId}/files`);
      const payload = (await response.json().catch(() => ({}))) as {
        files?: Gen2FileEntry[];
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? "Couldn't list the files.");
        return;
      }
      setFiles(payload.files ?? []);
      setError("");
    } catch {
      setError("Couldn't reach CoDev. Try again.");
    } finally {
      setLoading(false);
    }
  }, [ready, workspaceId]);

  const readFile = useCallback(
    async (path: string) => {
      // Reading does not wait on the guest mutation lock, so this works even
      // while Codex is mid-turn.
      const response = await fetch(
        `/api/gen2/workspaces/${workspaceId}/files`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        file?: Gen2File;
        error?: string;
      };
      if (!response.ok || !payload.file) {
        setError(payload.error ?? "That file could not be opened.");
        return;
      }
      setError("");
      setOpenFile(payload.file);
    },
    [workspaceId],
  );

  // Exposed so a file-change card in the chat can open the file it names.
  useEffect(() => {
    handleRef.current = {
      openFile(path) {
        setCollapsed(false);
        setTab("files");
        void readFile(path);
      },
    };
  }, [handleRef, readFile]);

  // The tree and search go through the guest's exec endpoint, which waits for
  // Codex to finish; refresh on the running→idle edge instead of failing.
  useEffect(() => {
    // Fetch-on-mount. apps/web has no data-fetching library, so an effect
    // is where a client component loads from its own API; these updates
    // land in an async continuation, which the rule cannot see.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!agentRunning) void loadFiles();
  }, [agentRunning, refreshToken, loadFiles]);

  useEffect(() => {
    // Fetch-on-mount. apps/web has no data-fetching library, so an effect
    // is where a client component loads from its own API; these updates
    // land in an async continuation, which the rule cannot see.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!agentRunning && openFile) void readFile(openFile.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentRunning, refreshToken]);

  /**
   * Upload straight onto the machine, so a file you have locally is a file
   * Codex can read. The guest stores UTF-8, so binary is refused up front
   * rather than written as mojibake.
   */
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    for (const file of Array.from(files).slice(0, 20)) {
      if (file.size > 1_024 * 1_024) {
        setError(`${file.name} is larger than 1 MB.`);
        continue;
      }
      const contents = await file.text();
      // A lone replacement character means the bytes were not text.
      if (contents.includes("\uFFFD")) {
        setError(`${file.name} is not a text file.`);
        continue;
      }
      const response = await fetch(
        `/api/gen2/workspaces/${workspaceId}/files`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: file.name, contents }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(payload.error ?? `${file.name} could not be uploaded.`);
      }
    }
    onRefresh();
  }

  function beginDrag(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    const body = bodyRef.current;

    function move(moveEvent: PointerEvent) {
      const next = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, startWidth + (startX - moveEvent.clientX)),
      );
      // Written straight to the DOM: a React state update per pointermove
      // would re-render CodeMirror and xterm on every pixel.
      body?.style.setProperty("--gen2-wb-width", `${next}px`);
    }
    function end(endEvent: PointerEvent) {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      setWidth(
        Math.min(
          MAX_WIDTH,
          Math.max(MIN_WIDTH, startWidth + (startX - endEvent.clientX)),
        ),
      );
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }

  function nudge(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      setWidth((value) => Math.min(MAX_WIDTH, value + 32));
    } else if (event.key === "ArrowRight") {
      setWidth((value) => Math.max(MIN_WIDTH, value - 32));
    } else if (event.key === "Home") {
      setCollapsed(true);
    } else if (event.key === "End") {
      setCollapsed(false);
    } else {
      return;
    }
    event.preventDefault();
  }

  if (collapsed) {
    return (
      <nav className="gen2-wb-rail" aria-label="Open workbench">
        <button
          type="button"
          className="gen2-wb-icon-button"
          onClick={() => setCollapsed(false)}
          aria-label="Open workbench"
        >
          <PanelRightOpen aria-hidden="true" size={15} />
        </button>
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className="gen2-wb-icon-button"
            onClick={() => {
              setTab(id);
              setCollapsed(false);
            }}
            aria-label={label}
            title={label}
          >
            <Icon aria-hidden="true" size={15} />
          </button>
        ))}
      </nav>
    );
  }

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize workbench"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        className="gen2-resizer"
        onPointerDown={beginDrag}
        onKeyDown={nudge}
      />
      <section
        className="gen2-wb"
        aria-label="Workbench"
        ref={bodyRef}
        style={{ "--gen2-wb-width": `${width}px` } as React.CSSProperties}
      >
        <header className="gen2-wb-bar">
          <div role="tablist" aria-label="Workbench" className="gen2-wb-tabs">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`gen2-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`gen2-panel-${id}`}
                tabIndex={tab === id ? 0 : -1}
                className="gen2-wb-tab"
                onClick={() => setTab(id)}
              >
                <Icon aria-hidden="true" size={13} />
                {label}
              </button>
            ))}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="gen2-visually-hidden"
            aria-label="Upload files to the machine"
            onChange={(event) => {
              void upload(event.target.files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="gen2-wb-icon-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={agentRunning}
            aria-label="Upload a file"
            title="Upload a file to this machine"
          >
            <Upload aria-hidden="true" size={13} />
          </button>
          <button
            type="button"
            className="gen2-wb-icon-button"
            onClick={onRefresh}
            disabled={loading || agentRunning}
            aria-label="Refresh from the machine"
          >
            <RefreshCw aria-hidden="true" size={13} />
          </button>
          <button
            type="button"
            className="gen2-wb-icon-button"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse workbench"
          >
            <ChevronRight aria-hidden="true" size={15} />
          </button>
        </header>

        {!ready ? (
          <p className="gen2-wb-empty">
            Start the instance to see this workspace&rsquo;s files.
          </p>
        ) : (
          <>
            <div
              role="tabpanel"
              id="gen2-panel-files"
              aria-labelledby="gen2-tab-files"
              hidden={tab !== "files"}
              className="gen2-wb-panel gen2-wb-files"
            >
              <div className="gen2-wb-tree">
                {error ? (
                  <p
                    className="gen2-wb-banner gen2-wb-banner-error"
                    role="alert"
                  >
                    {error}
                  </p>
                ) : null}
                <Gen2FileTree
                  files={files}
                  openPath={openFile?.path ?? null}
                  onOpen={(path) => void readFile(path)}
                />
              </div>
              <Gen2EditorPane
                workspaceId={workspaceId}
                file={openFile}
                agentRunning={agentRunning}
                onSaved={onRefresh}
              />
            </div>

            <div
              role="tabpanel"
              id="gen2-panel-terminal"
              aria-labelledby="gen2-tab-terminal"
              hidden={tab !== "terminal"}
              className="gen2-wb-panel"
            >
              <Gen2TerminalPane
                workspaceId={workspaceId}
                visible={tab === "terminal"}
                canStart={!agentRunning}
                onExit={onRefresh}
                onResumeWorkspace={onResumeWorkspace}
              />
            </div>

            <div
              role="tabpanel"
              id="gen2-panel-git"
              aria-labelledby="gen2-tab-git"
              hidden={tab !== "git"}
              className="gen2-wb-panel"
            >
              <Gen2GitPanel
                workspaceId={workspaceId}
                visible={tab === "git"}
                agentRunning={agentRunning}
                refreshToken={refreshToken}
                onOpenFile={(path) => {
                  setTab("files");
                  void readFile(path);
                }}
              />
            </div>
          </>
        )}
      </section>
    </>
  );
}
