"use client";

import { useState, type ComponentProps } from "react";
import {
  EthernetPort,
  ExternalLink,
  Maximize2,
  Minimize2,
  RotateCw,
} from "lucide-react";
import type { Gen2PreviewPortsResponse } from "@codev/contracts";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WorkspaceButton } from "./workspace-button";

type Ports = Gen2PreviewPortsResponse["ports"];

function ToolbarButton({
  label,
  ...props
}: ComponentProps<typeof WorkspaceButton> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <WorkspaceButton size="icon" aria-label={label} {...props} />
      </TooltipTrigger>
      <TooltipContent className="gen2-workspace-surface">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Keyed by the opened address, so it resets whenever a preview opens. */
function AddressForm({
  address,
  disabled,
  onNavigate,
}: {
  address: string;
  disabled: boolean;
  onNavigate(input: string): boolean;
}) {
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      className="gen2-browser-address"
      onSubmit={(event) => {
        event.preventDefault();
        const value = new FormData(event.currentTarget).get("address");
        setInvalid(!onNavigate(typeof value === "string" ? value : ""));
      }}
    >
      <Input
        name="address"
        defaultValue={address}
        aria-label="Preview address"
        aria-invalid={invalid || undefined}
        title={invalid ? "Enter a port, like 3000 or localhost:3000/path" : ""}
        placeholder="localhost:3000"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        onChange={() => setInvalid(false)}
      />
    </form>
  );
}

const EMPTY_PORTS = {
  loading: "Checking…",
  busy: "Workspace is busy — try again",
  ready: "No dev servers found",
} as const;

function PortMenu({
  ports,
  status,
  disabled,
  onOpen,
  onSelect,
}: {
  ports: Ports | null;
  status: keyof typeof EMPTY_PORTS;
  disabled: boolean;
  onOpen(): void;
  onSelect(port: number): void;
}) {
  return (
    <DropdownMenu onOpenChange={(open) => open && onOpen()}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <WorkspaceButton
              size="icon"
              aria-label="Dev servers"
              disabled={disabled}
            >
              <EthernetPort aria-hidden="true" />
            </WorkspaceButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent className="gen2-workspace-surface">
          Dev servers
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="gen2-workspace-surface gen2-browser-ports"
      >
        <DropdownMenuLabel>Dev servers</DropdownMenuLabel>
        {ports?.length ? (
          ports.map(({ port, address }) => (
            <DropdownMenuItem key={port} onSelect={() => onSelect(port)}>
              <span className="gen2-browser-port">:{port}</span>
              <span className="gen2-browser-port-scope">
                {address === "any" ? "All interfaces" : "Localhost"}
              </span>
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled>{EMPTY_PORTS[status]}</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type WorkspaceBrowserToolbarProps = {
  address: string;
  disabled: boolean;
  /** A port is chosen, so it can be reloaded or opened in a new tab. */
  hasTarget: boolean;
  ports: Ports | null;
  portsStatus: "loading" | "busy" | "ready";
  expanded: boolean;
  onNavigate(input: string): boolean;
  onPortsOpen(): void;
  onSelectPort(port: number): void;
  onReload(): void;
  onToggleExpand(): void;
  onOpenTab(): void;
};

/** Reload, address, dev servers, expand, and open in a new tab. */
export function WorkspaceBrowserToolbar(props: WorkspaceBrowserToolbarProps) {
  return (
    <header className="gen2-browser-toolbar">
      <ToolbarButton
        label="Reload preview"
        disabled={props.disabled || !props.hasTarget}
        onClick={props.onReload}
      >
        <RotateCw aria-hidden="true" />
      </ToolbarButton>
      <AddressForm
        key={props.address}
        address={props.address}
        disabled={props.disabled}
        onNavigate={props.onNavigate}
      />
      <PortMenu
        ports={props.ports}
        status={props.portsStatus}
        disabled={props.disabled}
        onOpen={props.onPortsOpen}
        onSelect={props.onSelectPort}
      />
      <ToolbarButton
        label="Expand preview"
        aria-pressed={props.expanded}
        onClick={props.onToggleExpand}
      >
        {props.expanded ? (
          <Minimize2 aria-hidden="true" />
        ) : (
          <Maximize2 aria-hidden="true" />
        )}
      </ToolbarButton>
      <ToolbarButton
        label="Open in new tab"
        disabled={props.disabled || !props.hasTarget}
        onClick={props.onOpenTab}
      >
        <ExternalLink aria-hidden="true" />
      </ToolbarButton>
    </header>
  );
}
