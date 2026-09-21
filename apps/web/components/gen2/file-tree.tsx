"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, File, Folder } from "lucide-react";
import type { Gen2FileEntry } from "@codev/contracts";

import {
  buildGen2FileTree,
  gen2StatusLabel,
  type Gen2TreeNode,
} from "@/lib/gen2/file-tree";

export function Gen2FileTree({
  files,
  openPath,
  onOpen,
}: {
  files: Gen2FileEntry[];
  openPath: string | null;
  onOpen: (path: string) => void;
}) {
  const tree = useMemo(() => buildGen2FileTree(files), [files]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  function toggle(path: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }

  if (files.length === 0) {
    return <p className="gen2-wb-empty">No files yet.</p>;
  }

  return (
    <ul className="gen2-tree" role="tree" aria-label="Workspace files">
      {tree.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          collapsed={collapsed}
          openPath={openPath}
          onOpen={onOpen}
          onToggle={toggle}
        />
      ))}
    </ul>
  );
}

function TreeNode({
  node,
  depth,
  collapsed,
  openPath,
  onOpen,
  onToggle,
}: {
  node: Gen2TreeNode;
  depth: number;
  collapsed: ReadonlySet<string>;
  openPath: string | null;
  onOpen: (path: string) => void;
  onToggle: (path: string) => void;
}) {
  // Indentation is a custom property so the row's hover and selection
  // backgrounds still span the full width of the pane.
  const indent = { "--gen2-depth": depth } as React.CSSProperties;

  if (node.kind === "file") {
    const selected = node.path === openPath;
    return (
      <li role="none">
        <button
          type="button"
          role="treeitem"
          aria-selected={selected}
          aria-level={depth + 1}
          className="gen2-tree-row"
          data-selected={selected}
          style={indent}
          onClick={() => onOpen(node.path)}
        >
          <File aria-hidden="true" size={13} className="gen2-tree-icon" />
          <span className="gen2-tree-name">{node.name}</span>
          {node.status ? (
            <span
              className="gen2-tree-status"
              data-status={node.status.trim()}
              title={gen2StatusLabel(node.status)}
            >
              {node.status.trim()}
            </span>
          ) : null}
        </button>
      </li>
    );
  }

  const isOpen = !collapsed.has(node.path);
  return (
    <li role="none">
      <button
        type="button"
        role="treeitem"
        aria-selected={false}
        aria-expanded={isOpen}
        aria-level={depth + 1}
        className="gen2-tree-row"
        style={indent}
        onClick={() => onToggle(node.path)}
      >
        {isOpen ? (
          <ChevronDown
            aria-hidden="true"
            size={13}
            className="gen2-tree-icon"
          />
        ) : (
          <ChevronRight
            aria-hidden="true"
            size={13}
            className="gen2-tree-icon"
          />
        )}
        <Folder aria-hidden="true" size={13} className="gen2-tree-icon" />
        <span className="gen2-tree-name">{node.name}</span>
        {node.changed ? (
          <span className="gen2-tree-dot" aria-label="Contains changes" />
        ) : null}
      </button>
      {isOpen ? (
        <ul role="group">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              openPath={openPath}
              onOpen={onOpen}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
