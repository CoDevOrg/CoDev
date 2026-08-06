"use client";

import { BarChart3, Bot, Code2, Globe2, type LucideIcon } from "lucide-react";

export type WorkspacePrimaryView = "chat" | "code" | "stats" | "preview";

const viewItems: Array<{
  id: WorkspacePrimaryView;
  label: string;
  description: string;
  Icon: LucideIcon;
}> = [
  {
    id: "chat",
    label: "Agent Console",
    description: "Open the agent conversation",
    Icon: Bot,
  },
  {
    id: "code",
    label: "Code & Diffs",
    description: "Browse files and inspect code changes",
    Icon: Code2,
  },
  {
    id: "stats",
    label: "Team Stats",
    description: "View workspace activity and collaborators",
    Icon: BarChart3,
  },
  {
    id: "preview",
    label: "Web Workspace",
    description: "Open the live web workspace",
    Icon: Globe2,
  },
];

export function WorkspaceViewNav({
  activeView,
  onSelect,
}: {
  activeView: WorkspacePrimaryView | null;
  onSelect: (view: WorkspacePrimaryView) => void;
}) {
  return (
    <nav className="workspace-view-nav" aria-label="Workspace views">
      {viewItems.map(({ id, label, description, Icon }) => (
        <button
          key={id}
          type="button"
          className={activeView === id ? "active" : ""}
          aria-label={label}
          title={description}
          aria-pressed={activeView === id}
          onClick={() => onSelect(id)}
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
