"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock,
  GitBranch,
  Kanban,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/platform/utils";
import { WorkspaceButton } from "./workspace-button";

export type BoardColumnKey =
  | "working"
  | "attention"
  | "review"
  | "idle"
  | "merged";

export interface BoardWorktreeItem {
  worktreeId: string;
  branch: string;
  fileCount: number;
  /** False until git status for this worktree has been read. */
  changesKnown?: boolean | undefined;
  agentStatus?:
    | "working"
    | "attention"
    | "review"
    | "idle"
    | "merged"
    | undefined;
  agentError?: string | null | undefined;
  agentProvider?: string | null | undefined;
  lastActivity?: string | undefined;
}

export interface SupersetWorkspacesBoardProps {
  items: BoardWorktreeItem[];
  selectedWorktreeId: string;
  onSelectWorktree: (
    worktreeId: string,
    openAgent?: boolean | undefined,
  ) => void;
  onCreateWorktree?: (() => void) | undefined;
  canEdit: boolean;
}

const COLUMNS: {
  key: BoardColumnKey;
  label: string;
  icon: typeof Sparkles;
}[] = [
  { key: "working", label: "Working", icon: Sparkles },
  { key: "attention", label: "Needs Attention", icon: AlertCircle },
  { key: "review", label: "Needs Review", icon: Clock },
  { key: "idle", label: "Idle", icon: CheckCircle2 },
  { key: "merged", label: "Merged", icon: GitBranch },
];

export function deriveCardColumn(item: BoardWorktreeItem): BoardColumnKey {
  if (item.agentStatus === "working") return "working";
  if (item.agentStatus === "attention" || item.agentError) return "attention";
  if (item.changesKnown !== false && item.fileCount > 0) return "review";
  if (item.agentStatus === "merged") return "merged";
  return "idle";
}

function cardDetail(item: BoardWorktreeItem, column: BoardColumnKey) {
  if (column === "working") {
    return { tone: "working" as const, text: "Agent turn running" };
  }
  if (column === "attention") {
    return {
      tone: "attention" as const,
      text: item.agentError?.trim() || "Needs attention",
    };
  }
  if (column === "review") {
    return {
      tone: "muted" as const,
      text: `${item.fileCount} changed ${item.fileCount === 1 ? "file" : "files"}`,
    };
  }
  if (item.changesKnown === false) {
    return { tone: "muted" as const, text: "Git status not loaded" };
  }
  if (column === "merged") {
    return { tone: "muted" as const, text: "Merged" };
  }
  return { tone: "muted" as const, text: "No uncommitted changes" };
}

export function SupersetWorkspacesBoard({
  items,
  selectedWorktreeId,
  onSelectWorktree,
  onCreateWorktree,
  canEdit,
}: SupersetWorkspacesBoardProps) {
  const [filterQuery, setFilterQuery] = useState("");

  const filteredItems = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    if (!query) return items;
    return items.filter(
      (item) =>
        item.branch.toLowerCase().includes(query) ||
        item.worktreeId.toLowerCase().includes(query),
    );
  }, [items, filterQuery]);

  const byColumn = useMemo(() => {
    const map = new Map<BoardColumnKey, BoardWorktreeItem[]>(
      COLUMNS.map((col) => [col.key, []]),
    );
    for (const item of filteredItems) {
      map.get(deriveCardColumn(item))?.push(item);
    }
    return map;
  }, [filteredItems]);

  return (
    <div
      role="region"
      className="gen2-workspaces-board"
      aria-label="Workspaces triage board"
    >
      <header className="gen2-board-header">
        <div className="gen2-board-heading">
          <div className="gen2-board-title-row">
            <Kanban aria-hidden="true" />
            <h2>Workspaces Board</h2>
            <Badge variant="secondary">
              {items.length} {items.length === 1 ? "worktree" : "worktrees"}
            </Badge>
          </div>
          <p>
            Branch identity first. Status follows a loaded agent or git result.
          </p>
        </div>

        <div className="gen2-board-toolbar">
          <div className="gen2-board-search">
            <Search aria-hidden="true" />
            <Input
              type="search"
              placeholder="Filter branches…"
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              aria-label="Filter branches"
            />
          </div>
          {canEdit && onCreateWorktree ? (
            <WorkspaceButton onClick={onCreateWorktree} tone="primary">
              <Plus data-icon="inline-start" aria-hidden="true" />
              New branch
            </WorkspaceButton>
          ) : null}
        </div>
      </header>

      {filterQuery.trim() && filteredItems.length === 0 ? (
        <Empty className="gen2-board-filter-empty">
          <EmptyHeader>
            <EmptyTitle>No branches match</EmptyTitle>
            <EmptyDescription>
              Nothing matches “{filterQuery.trim()}”.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="gen2-board-scroll">
          {COLUMNS.map((col) => {
            const colItems = byColumn.get(col.key) ?? [];
            const Icon = col.icon;
            return (
              <section
                key={col.key}
                className="gen2-board-column"
                aria-labelledby={`col-heading-${col.key}`}
              >
                <header className="gen2-board-column-header">
                  <div className="gen2-board-column-title">
                    <Icon aria-hidden="true" />
                    <h3 id={`col-heading-${col.key}`}>{col.label}</h3>
                  </div>
                  <Badge variant="muted">{colItems.length}</Badge>
                </header>

                <div className="gen2-board-column-list">
                  {colItems.length === 0 ? (
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>None</EmptyTitle>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    colItems.map((item) => {
                      const isSelected = item.worktreeId === selectedWorktreeId;
                      const detail = cardDetail(item, col.key);
                      return (
                        <Card
                          key={item.worktreeId}
                          role="article"
                          aria-label={`Worktree ${item.branch}`}
                          aria-current={isSelected ? "true" : undefined}
                          data-testid={`board-card-${item.worktreeId}`}
                          data-selected={isSelected || undefined}
                          data-state={col.key}
                          className={cn("gen2-board-card")}
                          onClick={() =>
                            onSelectWorktree(item.worktreeId, false)
                          }
                        >
                          <CardHeader className="gen2-board-card-header">
                            <CardTitle className="gen2-board-branch">
                              <GitBranch aria-hidden="true" />
                              <span>{item.branch}</span>
                            </CardTitle>
                            <CardDescription className="gen2-board-meta">
                              <span>{item.worktreeId}</span>
                              {item.agentProvider ? (
                                <span>{item.agentProvider}</span>
                              ) : null}
                            </CardDescription>
                          </CardHeader>

                          <CardContent className="gen2-board-card-body">
                            <p
                              className="gen2-board-status"
                              data-tone={detail.tone}
                            >
                              {detail.tone === "working" ? (
                                <span
                                  className="gen2-board-status-dot"
                                  aria-hidden="true"
                                />
                              ) : null}
                              {detail.text}
                            </p>
                          </CardContent>

                          <CardFooter className="gen2-board-card-actions">
                            <WorkspaceButton
                              tone="secondary"
                              onClick={(event) => {
                                event.stopPropagation();
                                onSelectWorktree(item.worktreeId, false);
                              }}
                            >
                              Open
                            </WorkspaceButton>
                            <WorkspaceButton
                              tone="secondary"
                              onClick={(event) => {
                                event.stopPropagation();
                                onSelectWorktree(item.worktreeId, true);
                              }}
                            >
                              <Bot
                                data-icon="inline-start"
                                aria-hidden="true"
                              />
                              Prompt
                            </WorkspaceButton>
                          </CardFooter>
                        </Card>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
