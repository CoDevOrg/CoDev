"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { Gen2SupersetFile } from "@codev/contracts";

import { useWorkspaceFileRequest } from "./use-workspace-file-request";
import type { TerminalTailReader } from "./use-workspace-terminal-io";
import { useWorkspaceTerminalTabs } from "./use-workspace-terminal-tabs";
import type { WorkspaceBrowserPaneState } from "./workspace-browser-pane";

export type WorkspaceEditorSelection = {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
};

const NO_PREVIEW: WorkspaceBrowserPaneState = {
  port: null,
  path: "/",
  listeningPorts: null,
};

function useIds() {
  const counter = useRef(0);
  return useCallback(() => (counter.current += 1), []);
}

/** What the inspector panes are asked to show, and what they report back. */
function useInspectorRequests() {
  const nextId = useIds();
  const [changesToken, setChangesToken] = useState(0);
  const [reviewFocus, setReviewFocus] = useState<{
    path: string;
    id: number;
  } | null>(null);
  const [previewRequest, setPreviewRequest] = useState<{
    id: string;
    port: number;
    path: string;
  } | null>(null);
  const [preview, setPreview] = useState(NO_PREVIEW);
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const actions = useMemo(
    () => ({
      refreshChanges: () => setChangesToken((token) => token + 1),
      focusReview: (path: string | null) =>
        setReviewFocus(path ? { path, id: nextId() } : null),
      requestPreview: (port: number, path: string) =>
        setPreviewRequest({ id: `preview-${nextId()}`, port, path }),
      onOpenFile: (file: Gen2SupersetFile | null) =>
        setOpenFilePath(file?.path ?? null),
      onPreviewState: setPreview,
    }),
    [nextId],
  );
  return {
    changesToken,
    reviewFocus,
    previewRequest,
    preview,
    openFilePath,
    ...actions,
  };
}

/** Text for the Share dialog and the next composer to start from. */
function useChatRequests() {
  const nextId = useIds();
  const [shareInvite, setShareInvite] = useState<{
    id: number;
    emailOrLogin: string;
  } | null>(null);
  const [draftRequest, setDraftRequest] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const actions = useMemo(
    () => ({
      prefillShare: (emailOrLogin: string) =>
        setShareInvite({ id: nextId(), emailOrLogin }),
      requestDraft: (text: string) =>
        setDraftRequest({ id: `draft-${nextId()}`, text }),
      consumeDraftRequest: (id: string) =>
        setDraftRequest((current) => (current?.id === id ? null : current)),
    }),
    [nextId],
  );
  return { shareInvite, draftRequest, ...actions };
}

/** Readers the shell keeps for the snapshot: editor selection, terminal tails. */
function useLiveReaders() {
  const selection = useRef<WorkspaceEditorSelection | null>(null);
  const tails = useRef(new Map<string, TerminalTailReader>());
  return useMemo(
    () => ({
      selection: () => selection.current,
      onSelectionText: (next: WorkspaceEditorSelection | null) => {
        selection.current = next;
      },
      tail: (tabId: string) => tails.current.get(tabId)?.() ?? "",
      onTailReader: (tabId: string, read: TerminalTailReader | null) => {
        if (read) tails.current.set(tabId, read);
        else tails.current.delete(tabId);
      },
    }),
    [],
  );
}

/**
 * The requests the workspace controller makes of the shell's panes, kept
 * as state the panes consume, plus what the panes report back.
 */
export function useWorkspaceRequests(worktreeId: string) {
  return {
    files: useWorkspaceFileRequest(),
    terminals: useWorkspaceTerminalTabs(worktreeId),
    inspector: useInspectorRequests(),
    chat: useChatRequests(),
    readers: useLiveReaders(),
  };
}
