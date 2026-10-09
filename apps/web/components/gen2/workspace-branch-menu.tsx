"use client";

import { Check, ChevronDown, GitBranch, Plus } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/platform/utils";
import { BranchStatusPill } from "./branch-status-pill";

export type BranchStatus = {
  label: string;
  tone: "clean" | "changes" | "unknown";
};
export type BranchOption = { worktreeId: string; branch: string };

export function WorkspaceBranchMenu({
  branches,
  selected,
  getStatus,
  loadError,
  onRetry,
  onSelect,
  onCreate,
}: {
  branches: BranchOption[];
  selected?: BranchOption | undefined;
  getStatus: (worktreeId: string) => BranchStatus;
  loadError: boolean;
  onRetry: () => void;
  onSelect: (worktreeId: string) => void;
  /** Omitted when the member cannot create branches. */
  onCreate?: (() => void) | undefined;
}) {
  const branch = selected?.branch ?? "main";
  const status = selected ? getStatus(selected.worktreeId) : null;
  return (
    <DropdownMenu>
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
        className="w-60 gen2-workspace-surface"
      >
        <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">
          Switch branch
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loadError ? (
          <DropdownMenuItem
            onSelect={onRetry}
            className="cursor-pointer py-1.5 px-2 text-xs text-muted-foreground"
          >
            Branch details unavailable · Retry
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuGroup>
          {branches.map((wt) => {
            const isSelected = wt.worktreeId === selected?.worktreeId;
            const st = getStatus(wt.worktreeId);
            return (
              <DropdownMenuItem
                key={wt.worktreeId}
                onClick={() => onSelect(wt.worktreeId)}
                className="flex items-center justify-between cursor-pointer py-1.5 px-2 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <GitBranch
                    size={13}
                    className={cn(
                      "shrink-0",
                      isSelected
                        ? "text-primary font-medium"
                        : "text-muted-foreground",
                    )}
                  />
                  <span
                    className={cn(
                      "truncate font-mono",
                      isSelected && "font-semibold text-primary",
                    )}
                  >
                    {wt.branch}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <BranchStatusPill
                    status={st}
                    className="gen2-worktree-status-pill"
                  />
                  {isSelected ? (
                    <Check size={13} className="text-primary" />
                  ) : null}
                </div>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
        {onCreate ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onCreate}
              className="cursor-pointer py-1.5 px-2 text-xs"
            >
              <Plus size={13} className="mr-2 shrink-0" />
              <span>New branch…</span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
