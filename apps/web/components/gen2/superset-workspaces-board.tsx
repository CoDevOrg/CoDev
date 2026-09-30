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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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
  description: string;
  icon: typeof Bot;
  badgeVariant: "default" | "secondary" | "outline" | "muted";
}[] = [
  {
    key: "working",
    label: "Working",
    description: "Agents executing turns and tools",
    icon: Sparkles,
    badgeVariant: "default",
  },
  {
    key: "attention",
    label: "Needs Attention",
    description: "Failed runs or interrupted agents",
    icon: AlertCircle,
    badgeVariant: "muted",
  },
  {
    key: "review",
    label: "Needs Review",
    description: "Branches with changed files",
    icon: Clock,
    badgeVariant: "secondary",
  },
  {
    key: "idle",
    label: "Idle",
    description: "Clean checkouts ready for work",
    icon: CheckCircle2,
    badgeVariant: "outline",
  },
  {
    key: "merged",
    label: "Merged",
    description: "Work merged into base branch",
    icon: GitBranch,
    badgeVariant: "outline",
  },
];

export function deriveCardColumn(item: BoardWorktreeItem): BoardColumnKey {
  if (item.agentStatus === "working") return "working";
  if (item.agentStatus === "attention" || item.agentError) return "attention";
  if (item.agentStatus === "review" || item.fileCount > 0) return "review";
  if (item.agentStatus === "merged") return "merged";
  return "idle";
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
      const col = deriveCardColumn(item);
      map.get(col)?.push(item);
    }
    return map;
  }, [filteredItems]);

  return (
    <div
      role="region"
      className="gen2-superset-board"
      aria-label="Workspaces triage board"
    >
      <header className="gen2-superset-board-header">
        <div className="gen2-superset-board-title-group">
          <div className="flex items-center gap-2">
            <Kanban
              className="size-5 text-muted-foreground"
              aria-hidden="true"
            />
            <h2 className="text-base font-semibold tracking-tight">
              Workspaces Board
            </h2>
            <Badge variant="secondary" className="text-xs">
              {items.length} {items.length === 1 ? "worktree" : "worktrees"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Multi-agent triage across isolated Git worktrees
          </p>
        </div>

        <div className="gen2-superset-board-controls">
          <div className="relative w-64">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              placeholder="Filter branches…"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="h-8 pl-8 text-xs bg-background/50"
              aria-label="Filter branches"
            />
          </div>
          {canEdit && onCreateWorktree ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={onCreateWorktree}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              New branch
            </Button>
          ) : null}
        </div>
      </header>

      <div className="gen2-superset-board-grid">
        {COLUMNS.map((col) => {
          const colItems = byColumn.get(col.key) ?? [];
          const Icon = col.icon;
          return (
            <section
              key={col.key}
              className="gen2-superset-board-col"
              aria-labelledby={`col-heading-${col.key}`}
            >
              <header className="gen2-superset-board-col-header">
                <div className="flex items-center gap-1.5">
                  <Icon
                    className="size-3.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <h3
                    id={`col-heading-${col.key}`}
                    className="text-xs font-semibold"
                  >
                    {col.label}
                  </h3>
                </div>
                <Badge
                  variant={col.badgeVariant}
                  className="text-[10px] px-1.5 py-0 tabular-nums"
                >
                  {colItems.length}
                </Badge>
              </header>

              <div className="gen2-superset-board-col-cards">
                {colItems.length === 0 ? (
                  <p className="gen2-superset-board-empty">No worktrees</p>
                ) : (
                  colItems.map((item) => {
                    const isSelected = item.worktreeId === selectedWorktreeId;
                    return (
                      <Card
                        key={item.worktreeId}
                        role="article"
                        aria-label={`Worktree ${item.branch}`}
                        data-testid={`board-card-${item.worktreeId}`}
                        className={`gen2-superset-board-card ${
                          isSelected
                            ? "border-primary/60 ring-1 ring-primary/20"
                            : ""
                        }`}
                        onClick={() => onSelectWorktree(item.worktreeId, false)}
                      >
                        <CardHeader className="p-3 pb-2 gap-1">
                          <div className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
                            <span className="font-mono truncate max-w-[120px]">
                              {item.worktreeId}
                            </span>
                            {item.agentProvider ? (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1 py-0 capitalize"
                              >
                                {item.agentProvider}
                              </Badge>
                            ) : null}
                          </div>
                          <CardTitle className="text-xs font-medium flex items-center gap-1.5 truncate">
                            <GitBranch className="size-3 text-muted-foreground shrink-0" />
                            <span className="truncate">{item.branch}</span>
                          </CardTitle>
                        </CardHeader>

                        <CardContent className="p-3 pt-0 pb-2.5 text-xs">
                          {col.key === "working" ? (
                            <div className="flex items-center gap-1.5 text-amber-500 font-medium text-[11px]">
                              <span className="size-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                              Agent turn running…
                            </div>
                          ) : col.key === "attention" ? (
                            <p className="text-destructive text-[11px] truncate">
                              {item.agentError ?? "Requires intervention"}
                            </p>
                          ) : col.key === "review" ? (
                            <p className="text-emerald-500 text-[11px] font-mono">
                              {item.fileCount} changed{" "}
                              {item.fileCount === 1 ? "file" : "files"}
                            </p>
                          ) : (
                            <p className="text-muted-foreground text-[11px]">
                              Clean working tree
                            </p>
                          )}
                        </CardContent>

                        <CardFooter className="p-2.5 pt-2 border-t border-border/40 flex items-center justify-between gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[11px]"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectWorktree(item.worktreeId, false);
                            }}
                          >
                            Open Stage
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[11px] gap-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectWorktree(item.worktreeId, true);
                            }}
                          >
                            <Bot className="size-2.5" />
                            Prompt
                          </Button>
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
    </div>
  );
}
