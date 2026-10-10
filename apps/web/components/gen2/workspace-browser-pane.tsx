"use client";

import { useEffect, useRef, useState } from "react";
import type { Gen2PreviewPortsResponse } from "@codev/contracts";

import { TooltipProvider } from "@/components/ui/tooltip";
import { formatPreviewAddress, parsePreviewAddress } from "./preview-address";
import { useBrowserPreview, type PreviewPhase } from "./use-browser-preview";
import {
  mintPreviewSession,
  usePreviewSessionRefresh,
} from "./use-preview-session";
import { WorkspaceBrowserFrame } from "./workspace-browser-frame";
import {
  WorkspaceBrowserState,
  type BrowserView,
} from "./workspace-browser-state";
import { WorkspaceBrowserToolbar } from "./workspace-browser-toolbar";

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

type Preview = ReturnType<typeof useBrowserPreview>;

function requestView(phase: PreviewPhase, port: number, error: string) {
  const views: Partial<Record<PreviewPhase, BrowserView>> = {
    waiting: { kind: "waiting", port },
    missing: { kind: "missing", port },
    opening: { kind: "opening", port },
    error: { kind: "error", message: error },
    open: { kind: "frame" },
  };
  return views[phase] ?? null;
}

function browserView(
  props: WorkspaceBrowserPaneProps,
  preview: Preview,
): BrowserView {
  if (!props.connected) return { kind: "offline" };
  if (!props.canEdit) return { kind: "viewer" };
  const { ports, error: portsError } = preview.ports;
  if (ports && !ports.available && ports.reason !== "busy")
    return { kind: "unavailable", reason: ports.reason ?? "not_ready" };
  const requested =
    preview.target &&
    requestView(preview.phase, preview.target.port, preview.error);
  if (requested) return requested;
  if (!ports)
    return portsError
      ? { kind: "error", message: portsError }
      : { kind: "checking" };
  if (ports.reason === "busy") return { kind: "busy" };
  if (!ports.ports.length) return { kind: "empty" };
  return { kind: "choose", ports: ports.ports.map(({ port }) => port) };
}

/** Tells the shell what the pane shows, for the agent's workspace snapshot. */
function useReportedState(
  onStateChange: WorkspaceBrowserPaneProps["onStateChange"],
  preview: Preview,
  ports: Gen2PreviewPortsResponse | null,
) {
  const report = useRef(onStateChange);
  useEffect(() => {
    report.current = onStateChange;
  });
  const port =
    preview.phase === "open" && preview.target ? preview.target.port : null;
  const path = preview.target?.path ?? "/";
  const listening = ports?.available
    ? ports.ports.map((entry) => entry.port).join(",")
    : null;
  useEffect(() => {
    const listeningPorts =
      listening === null ? null : listening.split(",").filter(Boolean);
    report.current({
      port,
      path,
      listeningPorts: listeningPorts?.map(Number) ?? null,
    });
  }, [port, path, listening]);
}

/** Expand (reset when the tab hides), typed addresses, and new tabs. */
function usePaneControls(props: WorkspaceBrowserPaneProps, preview: Preview) {
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState("");
  const { visible, onExpandChange, workspaceId } = props;
  const { target, open } = preview;
  useEffect(() => {
    if (visible || !expanded) return;
    const timer = setTimeout(() => {
      setExpanded(false);
      onExpandChange(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [visible, expanded, onExpandChange]);
  return {
    expanded,
    notice,
    toggleExpand() {
      setExpanded(!expanded);
      onExpandChange(!expanded);
    },
    navigate(input: string) {
      const address = parsePreviewAddress(input);
      const port = address?.port ?? target?.port;
      if (!address || !port) return false;
      open({ port, path: address.path });
      return true;
    },
    async openTab() {
      if (!target) return;
      setNotice("");
      try {
        const url = await mintPreviewSession(workspaceId, target);
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (caught) {
        setNotice(
          caught instanceof Error
            ? caught.message
            : "Couldn’t open the preview.",
        );
      }
    },
  };
}

/** The preview frame, or the state that replaces it while loading. */
function BrowserStage({
  workspaceId,
  visible,
  view,
  preview,
}: {
  workspaceId: string;
  visible: boolean;
  view: BrowserView;
  preview: Preview;
}) {
  const { target, url } = preview;
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const framed = view.kind === "frame" && url !== null && target !== null;
  const refresh = usePreviewSessionRefresh(
    workspaceId,
    framed ? target.port : null,
    framed ? url : null,
    framed && visible,
  );
  return (
    <div className="gen2-browser-stage">
      {framed ? (
        <WorkspaceBrowserFrame
          key={url}
          url={url}
          port={target.port}
          active={visible}
          refreshUrl={refresh.refreshUrl}
          onLoad={() => setLoadedUrl(url)}
          onRefreshed={refresh.refreshed}
        />
      ) : null}
      <WorkspaceBrowserState
        view={
          framed && loadedUrl !== url
            ? { kind: "loading", port: target.port }
            : view
        }
        onRetry={() =>
          target ? preview.open(target) : void preview.ports.refresh()
        }
        onCancel={preview.cancel}
        onOpenAnyway={() => target && void preview.mint(target)}
        onOpenPort={(port) => preview.open({ port, path: "/" })}
      />
    </div>
  );
}

/**
 * The inspector's Browser tab: previews a dev server running in the
 * workspace through the guest's preview proxy, on a separate site.
 */
export function WorkspaceBrowserPane(props: WorkspaceBrowserPaneProps) {
  const preview = useBrowserPreview(props);
  const { target, ports } = preview;
  const controls = usePaneControls(props, preview);
  useReportedState(props.onStateChange, preview, ports.ports);
  return (
    <TooltipProvider delayDuration={300}>
      <section
        id="superset-panel-browser"
        role="tabpanel"
        aria-labelledby="superset-tab-browser"
        hidden={!props.visible}
        className="gen2-ide-panel gen2-browser"
      >
        <WorkspaceBrowserToolbar
          address={target ? formatPreviewAddress(target.port, target.path) : ""}
          disabled={!props.connected || !props.canEdit}
          hasTarget={target !== null}
          ports={ports.ports?.ports ?? null}
          portsStatus={
            ports.loading
              ? "loading"
              : ports.ports?.reason === "busy"
                ? "busy"
                : "ready"
          }
          expanded={controls.expanded}
          onNavigate={controls.navigate}
          onPortsOpen={() => void ports.refresh()}
          onSelectPort={(port) => preview.open({ port, path: "/" })}
          onReload={() => target && void preview.mint(target)}
          onToggleExpand={controls.toggleExpand}
          onOpenTab={() => void controls.openTab()}
        />
        {controls.notice ? (
          <p
            className="gen2-superset-notice gen2-superset-notice-error"
            role="alert"
          >
            {controls.notice}
          </p>
        ) : null}
        <BrowserStage
          workspaceId={props.workspaceId}
          visible={props.visible}
          view={browserView(props, preview)}
          preview={preview}
        />
      </section>
    </TooltipProvider>
  );
}
