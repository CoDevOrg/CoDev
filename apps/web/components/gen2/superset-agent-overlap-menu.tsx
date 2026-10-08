"use client";

import type { Gen2AgentOverlap } from "@codev/contracts";
import { GitBranch } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WorkspaceButton } from "./workspace-button";

const MAX_LISTED_PATHS = 5;

function byOtherRun(overlaps: Gen2AgentOverlap[]) {
  const groups = new Map<string, Gen2AgentOverlap[]>();
  for (const overlap of overlaps) {
    groups.set(overlap.otherRunId, [
      ...(groups.get(overlap.otherRunId) ?? []),
      overlap,
    ]);
  }
  return [...groups.values()];
}

/**
 * Where another active agent is changing the same files as this run. It shows
 * only metadata every member can already see and offers navigation, never a
 * control over another member's agent.
 */
export function SupersetAgentOverlapMenu({
  overlaps,
  branchFor,
  memberLabel,
  onOpenWorktree,
}: {
  overlaps: Gen2AgentOverlap[];
  branchFor: (worktreeId: string) => string;
  memberLabel: (userId: string) => string;
  onOpenWorktree: (worktreeId: string) => void;
}) {
  if (overlaps.length === 0) return null;
  const files = new Set(overlaps.map((overlap) => overlap.path)).size;
  const label = `${files} ${files === 1 ? "file overlaps" : "files overlap"} with other agents`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <WorkspaceButton
          className="gen2-ide-agent-overlap-trigger"
          aria-label={label}
          title={label}
        >
          <span className="gen2-ide-agent-overlap-dot" aria-hidden="true" />
          <span className="gen2-ide-agent-overlap-count">overlaps {files}</span>
        </WorkspaceButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="gen2-workspace-surface gen2-ide-agent-overlap-menu"
      >
        <DropdownMenuLabel>Also changing these files</DropdownMenuLabel>
        {byOtherRun(overlaps).map((group) => {
          const [first] = group;
          if (!first) return null;
          const shown = group.slice(0, MAX_LISTED_PATHS);
          return (
            <DropdownMenuGroup key={first.otherRunId}>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="gen2-ide-agent-overlap-agent">
                <span className="gen2-ide-agent-overlap-branch">
                  {branchFor(first.otherWorktreeId)}
                </span>
                {" · "}
                {first.otherProvider} · {memberLabel(first.otherCreatedBy)}
              </DropdownMenuLabel>
              {shown.map((overlap) => (
                <DropdownMenuLabel
                  key={overlap.path}
                  className="gen2-ide-agent-overlap-path"
                  title={overlap.path}
                >
                  <span>{overlap.path}</span>
                  {overlap.symbols.length > 0 ? (
                    <span>
                      {overlap.symbols
                        .map((symbol) => `${symbol}()`)
                        .join(", ")}
                    </span>
                  ) : null}
                </DropdownMenuLabel>
              ))}
              {group.length > shown.length ? (
                <DropdownMenuLabel className="gen2-ide-agent-overlap-more">
                  +{group.length - shown.length} more
                </DropdownMenuLabel>
              ) : null}
              <DropdownMenuItem
                onSelect={() => onOpenWorktree(first.otherWorktreeId)}
              >
                <GitBranch aria-hidden="true" />
                Open branch
              </DropdownMenuItem>
            </DropdownMenuGroup>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
