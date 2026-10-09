"use client";

import Link from "next/link";
import {
  Cloud,
  Kanban,
  LoaderCircle,
  PanelLeft,
  PanelRight,
  Settings,
  UserPlus,
} from "lucide-react";

import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/platform/utils";
import { ProviderLogo, type SupportedAiProvider } from "./provider-logos";
import { WorkspaceBranchMenu } from "./workspace-branch-menu";
import { WorkspaceButton } from "./workspace-button";

type ConnectionState = "checking" | "connecting" | "connected" | "disconnected";

function ConnectionBadge({ state }: { state: ConnectionState }) {
  if (state === "connected")
    return (
      <Badge variant="outline" role="status">
        <span className="gen2-status-dot ready" aria-hidden="true" />
        Ready
      </Badge>
    );
  if (state === "disconnected")
    return (
      <Badge variant="outline" role="status">
        <span className="gen2-status-dot error" aria-hidden="true" />
        Offline
      </Badge>
    );
  return (
    <Badge variant="outline" role="status">
      <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
      {state === "connecting" ? "Reconnecting…" : "Connecting…"}
    </Badge>
  );
}

function IconAction({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <WorkspaceButton
          size="icon"
          className={cn("gen2-ide-icon-button", active && "active")}
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </WorkspaceButton>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function WorkspaceTopBar({
  workspaceName,
  repositoryName,
  branchMenu,
  sessionTitle,
  sessionProvider,
  agentRunning,
  connectionState,
  viewMode,
  sidebarCollapsed,
  inspectorCollapsed,
  onReconnect,
  onShare,
  onOpenSettings,
  onToggleViewMode,
  onToggleSidebar,
  onToggleInspector,
}: {
  workspaceName: string;
  repositoryName?: string | undefined;
  branchMenu: React.ComponentProps<typeof WorkspaceBranchMenu>;
  sessionTitle: string;
  /** Set only while the active agent is connected. */
  sessionProvider: SupportedAiProvider | null;
  agentRunning: boolean;
  connectionState: ConnectionState;
  viewMode: "ide" | "board";
  sidebarCollapsed: boolean;
  inspectorCollapsed: boolean;
  onReconnect: () => void;
  onShare: () => void;
  onOpenSettings: () => void;
  onToggleViewMode: () => void;
  onToggleSidebar: () => void;
  onToggleInspector: () => void;
}) {
  const sidebarLabel = sidebarCollapsed ? "Expand sidebar" : "Minimize sidebar";
  const inspectorLabel = inspectorCollapsed
    ? "Expand inspector"
    : "Collapse inspector";
  return (
    <header className="gen2-ide-top-navbar" aria-label="Top navigation">
      <div className="gen2-ide-top-navbar-left">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/gen2"
              className="gen2-workspace-button gen2-ide-icon-button"
              data-slot="button"
              data-tone="ghost"
              data-size="icon"
              aria-label="Back to home"
            >
              <img
                className="gen2-brand-mark"
                src="/brand/codev-mark.svg"
                alt="CoDev"
                width={22}
                height={22}
              />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="bottom">All workspaces</TooltipContent>
        </Tooltip>

        <IconAction
          label={sidebarLabel}
          active={sidebarCollapsed}
          onClick={onToggleSidebar}
        >
          <PanelLeft size={16} />
        </IconAction>

        <Breadcrumb className="min-w-0 gen2-topbar-breadcrumb">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>{workspaceName}</BreadcrumbPage>
            </BreadcrumbItem>
            {repositoryName ? (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem className="gen2-topbar-breadcrumb-repo">
                  <span className="truncate">{repositoryName}</span>
                </BreadcrumbItem>
              </>
            ) : null}
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <WorkspaceBranchMenu {...branchMenu} />
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <div className="gen2-ide-top-navbar-center">
        <div className="gen2-topbar-session-card">
          {sessionProvider ? (
            <div className="gen2-topbar-provider-avatar">
              <ProviderLogo provider={sessionProvider} size={14} />
            </div>
          ) : null}
          <span className="gen2-topbar-session-title">{sessionTitle}</span>
          {agentRunning ? (
            <span className="gen2-topbar-session-status running">
              <span className="gen2-status-dot working" aria-hidden="true" />
              Working…
            </span>
          ) : null}
        </div>
      </div>

      <div className="gen2-ide-top-navbar-right">
        <ConnectionBadge state={connectionState} />
        {connectionState === "disconnected" && viewMode === "board" ? (
          <WorkspaceButton
            tone="secondary"
            onClick={onReconnect}
            aria-label="Reconnect workspace"
          >
            <Cloud data-icon="inline-start" aria-hidden="true" />
            <span className="gen2-topbar-action-label">Reconnect</span>
          </WorkspaceButton>
        ) : null}

        <WorkspaceButton
          tone="secondary"
          onClick={onShare}
          aria-label="Share workspace"
        >
          <UserPlus data-icon="inline-start" aria-hidden="true" />
          <span className="gen2-topbar-action-label">Share</span>
        </WorkspaceButton>

        <WorkspaceButton
          className={cn(
            "gen2-topbar-nav-button",
            viewMode === "board" && "active",
          )}
          aria-pressed={viewMode === "board"}
          onClick={onToggleViewMode}
          aria-label={
            viewMode === "board" ? "Switch to IDE Stage" : "Switch to Board"
          }
        >
          <Kanban data-icon="inline-start" aria-hidden="true" />
          <span className="gen2-topbar-action-label">
            {viewMode === "board" ? "IDE Stage" : "Board"}
          </span>
        </WorkspaceButton>

        <Separator orientation="vertical" className="h-4 my-auto opacity-40" />

        <IconAction label="Settings" onClick={onOpenSettings}>
          <Settings size={16} />
        </IconAction>
        <ThemeToggle compact />

        {viewMode === "ide" ? (
          <IconAction
            label={inspectorLabel}
            active={inspectorCollapsed}
            onClick={onToggleInspector}
          >
            <PanelRight size={16} />
          </IconAction>
        ) : null}
      </div>
    </header>
  );
}
