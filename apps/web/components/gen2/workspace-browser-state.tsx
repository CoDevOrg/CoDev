"use client";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { WorkspaceButton } from "./workspace-button";

/** What the Browser tab shows instead of (or over) the preview frame. */
export type BrowserView =
  | { kind: "offline" }
  | { kind: "viewer" }
  | {
      kind: "unavailable";
      reason: "not_configured" | "image_update" | "not_ready";
    }
  | { kind: "busy" }
  | { kind: "checking" }
  | { kind: "empty" }
  | { kind: "choose"; ports: number[] }
  | { kind: "waiting"; port: number }
  | { kind: "missing"; port: number }
  | { kind: "opening"; port: number }
  | { kind: "loading"; port: number }
  | { kind: "error"; message: string }
  | { kind: "frame" };

type Actions = {
  onRetry(): void;
  onCancel(): void;
  onOpenAnyway(): void;
  onOpenPort(port: number): void;
};

type Action = { label: string; run(): void };

type Description = {
  title: string;
  description?: string;
  role?: "status" | "alert";
  actions?: Action[];
};

const UNAVAILABLE = {
  not_configured: {
    title: "Browser previews aren’t set up",
    description: "This CoDev deployment has no preview domain yet.",
  },
  image_update: {
    title: "Update this workspace to use the browser",
    description:
      "Its machine predates browser previews. They work once it runs a newer workspace image.",
  },
  not_ready: { title: "Previews load when the workspace is ready." },
} as const;

/** States that describe the workspace rather than one requested port. */
function describeWorkspace(
  view: BrowserView,
  actions: Actions,
): Description | null {
  switch (view.kind) {
    case "offline":
      return { title: "Previews load when the workspace is connected." };
    case "viewer":
      return {
        title: "Only editors can open previews",
        description:
          "Ask an owner for edit access to preview apps running in this workspace.",
      };
    case "unavailable":
      return UNAVAILABLE[view.reason];
    case "busy":
      return {
        title: "Workspace is busy — try again",
        role: "status",
        actions: [{ label: "Try again", run: actions.onRetry }],
      };
    case "checking":
      return { title: "Checking for dev servers…", role: "status" };
    case "empty":
      return {
        title: "No dev server running",
        description:
          "Start one in the terminal; servers started by an agent’s own process may not be previewable.",
      };
    case "choose":
      return {
        title: "Choose a dev server to preview",
        actions: view.ports.slice(0, 6).map((port) => ({
          label: `:${port}`,
          run: () => actions.onOpenPort(port),
        })),
      };
    default:
      return null;
  }
}

/** States of the port the member, an agent, or a command asked for. */
function describeRequest(view: BrowserView, actions: Actions): Description {
  const anyway = { label: "Open anyway", run: actions.onOpenAnyway };
  switch (view.kind) {
    case "waiting":
      return {
        title: `Waiting for :${view.port}…`,
        role: "status",
        actions: [{ label: "Cancel", run: actions.onCancel }, anyway],
      };
    case "missing":
      return {
        title: `Nothing is listening on :${view.port} yet`,
        description: "Start the server in the terminal, then try again.",
        actions: [{ label: "Try again", run: actions.onRetry }, anyway],
      };
    case "opening":
      return { title: `Opening :${view.port}…`, role: "status" };
    case "loading":
      return { title: `Loading :${view.port}…`, role: "status" };
    case "error":
      return {
        title: view.message,
        role: "alert",
        actions: [{ label: "Try again", run: actions.onRetry }],
      };
    default:
      return { title: "" };
  }
}

export function WorkspaceBrowserState({
  view,
  ...actions
}: { view: BrowserView } & Actions) {
  if (view.kind === "frame") return null;
  const state: Description =
    describeWorkspace(view, actions) ?? describeRequest(view, actions);
  return (
    <Empty
      className="gen2-browser-state"
      data-overlay={view.kind === "loading" || undefined}
      role={state.role}
    >
      <EmptyHeader>
        <EmptyTitle>{state.title}</EmptyTitle>
        {state.description ? (
          <EmptyDescription>{state.description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {state.actions?.length ? (
        <div className="gen2-browser-actions">
          {state.actions.map((action) => (
            <WorkspaceButton
              key={action.label}
              tone="secondary"
              onClick={action.run}
            >
              {action.label}
            </WorkspaceButton>
          ))}
        </div>
      ) : null}
    </Empty>
  );
}
