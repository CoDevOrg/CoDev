"use client";

import { useState } from "react";
import { Check, ChevronDown, GitBranch, Plus, Search } from "lucide-react";
import type { Gen2RemoteBranchList } from "@codev/contracts";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BranchStatusPill } from "./branch-status-pill";
import { useRemoteBranches } from "./use-remote-branches";

export type BranchStatus = {
  label: string;
  tone: "clean" | "changes" | "unknown";
};
export type BranchOption = { worktreeId: string; branch: string };

/** Show the filter once the menu would otherwise need scrolling. */
const FILTER_THRESHOLD = 8;

const UNAVAILABLE: Record<
  NonNullable<Gen2RemoteBranchList["unavailable"]>,
  string
> = {
  "no-repository": "This workspace isn’t connected to a GitHub repository.",
  "github-not-connected":
    "Connect GitHub in Settings to see this repository’s branches.",
  "github-no-access": "Your GitHub account can’t see this repository.",
};

function Note({ children }: { children: React.ReactNode }) {
  return <p className="gen2-branch-menu-note">{children}</p>;
}

/**
 * The top bar's branch switcher. Branches already open in the workspace
 * switch immediately; any other branch on GitHub opens in a worktree of its
 * own. Private repositories reach the machine as a snapshot of one commit, so
 * their other branches are listed but cannot be opened yet.
 */
export function WorkspaceBranchMenu({
  workspaceId,
  branches,
  selected,
  getStatus,
  loadError,
  repositoryPrivate = false,
  onRetry,
  onSelect,
  onOpenRemote,
  onCreate,
}: {
  workspaceId: string;
  /** Branches checked out in the workspace's worktrees. */
  branches: BranchOption[];
  selected?: BranchOption | undefined;
  getStatus: (worktreeId: string) => BranchStatus;
  loadError: boolean;
  repositoryPrivate?: boolean;
  onRetry: () => void;
  onSelect: (worktreeId: string) => void;
  /** Omitted when the member cannot open branches. */
  onOpenRemote?: ((branch: string) => void) | undefined;
  /** Omitted when the member cannot create branches. */
  onCreate?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const remote = useRemoteBranches(workspaceId, open);
  const branch = selected?.branch ?? "main";
  const status = selected ? getStatus(selected.worktreeId) : null;
  const needle = query.trim().toLowerCase();
  const openNames = new Set(branches.map((option) => option.branch));
  const matchesQuery = (name: string) => name.toLowerCase().includes(needle);
  const local = branches.filter((option) => matchesQuery(option.branch));
  const list = remote.list;
  const remoteNames = (list?.branches ?? [])
    .map((item) => item.name)
    .filter((name) => !openNames.has(name) && matchesQuery(name));
  const canOpenRemote = Boolean(onOpenRemote) && !repositoryPrivate;
  const showFilter =
    branches.length + (list?.branches.length ?? 0) > FILTER_THRESHOLD;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="gen2-topbar-branch-pill"
          aria-label={`Active branch: ${branch}`}
        >
          <GitBranch size={13} className="gen2-topbar-branch-icon" />
          <span className="gen2-topbar-branch-name">{branch}</span>
          <BranchStatusPill
            status={status}
            className="gen2-topbar-branch-status"
          />
          <ChevronDown
            size={11}
            className="text-muted-foreground ml-0.5 shrink-0 opacity-70"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="gen2-workspace-surface gen2-branch-menu"
      >
        {showFilter ? (
          <label className="gen2-branch-menu-filter">
            <Search aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              // Keep typing in the field instead of the menu's type-ahead.
              onKeyDown={(event) => {
                if (event.key !== "Escape") event.stopPropagation();
              }}
              placeholder="Find a branch"
              aria-label="Find a branch"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        ) : null}
        <div className="gen2-branch-menu-scroll">
          <DropdownMenuLabel>Open in workspace</DropdownMenuLabel>
          {loadError ? (
            <DropdownMenuItem onSelect={onRetry}>
              Branch details unavailable · Retry
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuGroup>
            {local.map((option) => {
              const isSelected = option.worktreeId === selected?.worktreeId;
              return (
                <DropdownMenuItem
                  key={option.worktreeId}
                  onSelect={() => onSelect(option.worktreeId)}
                  data-selected={isSelected || undefined}
                >
                  <GitBranch aria-hidden="true" />
                  <span className="gen2-branch-menu-name">{option.branch}</span>
                  <BranchStatusPill
                    status={getStatus(option.worktreeId)}
                    className="gen2-worktree-status-pill"
                  />
                  {isSelected ? <Check aria-label="Current branch" /> : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
          {needle && local.length === 0 ? (
            <Note>No open branch matches.</Note>
          ) : null}

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Remote branches</DropdownMenuLabel>
          {remote.status === "error" ? (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                void remote.reload();
              }}
            >
              {remote.error} · Retry
            </DropdownMenuItem>
          ) : null}
          {!list && remote.status !== "error" ? (
            <Note>Loading branches from GitHub…</Note>
          ) : null}
          {list?.unavailable ? (
            <Note>{UNAVAILABLE[list.unavailable]}</Note>
          ) : null}
          {list && !list.unavailable && repositoryPrivate ? (
            <Note>
              Private repositories are copied without their other branches, so
              these can’t be opened here yet.
            </Note>
          ) : null}
          <DropdownMenuGroup>
            {remoteNames.map((name) => (
              <DropdownMenuItem
                key={name}
                disabled={!canOpenRemote}
                onSelect={() => onOpenRemote?.(name)}
              >
                <GitBranch aria-hidden="true" />
                <span className="gen2-branch-menu-name">{name}</span>
                {name === list?.defaultBranch ? (
                  <span className="gen2-branch-menu-tag">default</span>
                ) : canOpenRemote ? (
                  <span className="gen2-branch-menu-hint">Open</span>
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          {list && !list.unavailable && remoteNames.length === 0 ? (
            <Note>
              {needle
                ? "No remote branch matches."
                : "Every remote branch is already open."}
            </Note>
          ) : null}
          {list?.truncated ? (
            <Note>Showing the first 300 branches.</Note>
          ) : null}
        </div>
        {onCreate ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onCreate}>
              <Plus aria-hidden="true" />
              New branch…
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
