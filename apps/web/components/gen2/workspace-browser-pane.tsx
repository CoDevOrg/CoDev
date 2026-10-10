"use client";

export type WorkspaceBrowserPaneState = {
  port: number | null;
  path: string;
  listeningPorts: number[] | null;
};

export type WorkspaceBrowserPaneProps = {
  workspaceId: string;
  visible: boolean;
  canEdit: boolean;
  connected: boolean;
  /** A preview to open (from an agent action or a slash command). */
  request: { id: string; port: number; path: string } | null;
  onExpandChange(expanded: boolean): void;
  onStateChange(state: WorkspaceBrowserPaneState): void;
};

/**
 * The inspector's Browser tab: previews a dev server on the workspace.
 * Placeholder: the implementation lands with the browser preview package.
 */
export function WorkspaceBrowserPane(props: WorkspaceBrowserPaneProps) {
  void props;
  return null;
}
