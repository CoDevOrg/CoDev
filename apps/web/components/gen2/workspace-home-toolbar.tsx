"use client";

import { LayoutGrid, List, Search } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { WorkspaceFilter } from "@/components/gen2/workspace-list";

const FILTER_LABEL: Record<WorkspaceFilter, string> = {
  all: "All",
  owned: "Owned",
  shared: "Shared",
};

/** Search, ownership filter, and grid/list switch for the workspace home. */
export function WorkspaceHomeToolbar({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  counts,
  viewMode,
  onViewModeChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  filter: WorkspaceFilter;
  onFilterChange: (filter: WorkspaceFilter) => void;
  counts: Record<WorkspaceFilter, number>;
  viewMode: "grid" | "list";
  onViewModeChange: (mode: "grid" | "list") => void;
}) {
  return (
    <div className="gen2-toolbar">
      <label className="gen2-search-box">
        <Search className="gen2-search-icon" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) onQueryChange("");
          }}
          placeholder="Search by name or repository"
          aria-label="Search workspaces"
          autoComplete="off"
          spellCheck={false}
          maxLength={120}
        />
      </label>

      <ToggleGroup
        type="single"
        aria-label="Filter workspaces"
        value={filter}
        onValueChange={(value) => {
          if (value) onFilterChange(value as WorkspaceFilter);
        }}
      >
        {(Object.keys(FILTER_LABEL) as WorkspaceFilter[]).map((key) => (
          <ToggleGroupItem key={key} value={key} aria-label={FILTER_LABEL[key]}>
            {FILTER_LABEL[key]}
            <span className="gen2-filter-count" aria-hidden="true">
              {counts[key]}
            </span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <ToggleGroup
        type="single"
        aria-label="Layout"
        className="gen2-view-switcher"
        value={viewMode}
        onValueChange={(value) => {
          if (value) onViewModeChange(value as "grid" | "list");
        }}
      >
        <ToggleGroupItem value="grid" aria-label="Grid view" title="Grid view">
          <LayoutGrid aria-hidden="true" />
        </ToggleGroupItem>
        <ToggleGroupItem value="list" aria-label="List view" title="List view">
          <List aria-hidden="true" />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
