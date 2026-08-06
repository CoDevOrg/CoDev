"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  type LucideIcon,
} from "lucide-react";

import {
  buildFileTree,
  collectDirectoryPaths,
  fileExtension,
  type FileTreeNode,
} from "@/lib/file-tree";
import type { WorkspaceFile } from "@/lib/ide";
import type { CollaborationUser } from "@/lib/collaboration-client";

function FileIcon({ path }: { path: string }) {
  const extension = fileExtension(path);
  const Icon: LucideIcon =
    extension === "json" || extension === "jsonc"
      ? FileJson
      : extension === "md" ||
          extension === "txt" ||
          extension === "gitignore" ||
          extension === "env" ||
          extension === "example"
        ? FileText
        : FileCode2;
  return (
    <Icon
      className={`file-kind file-kind-${extension || "file"}`}
      aria-hidden="true"
    />
  );
}

function TreeRows({
  nodes,
  depth,
  openPath,
  collapsed,
  presenceByPath,
  onToggle,
  onOpen,
  collaboratorLabel,
}: {
  nodes: FileTreeNode[];
  depth: number;
  openPath?: string | undefined;
  collapsed: Set<string>;
  presenceByPath: Map<string, CollaborationUser[]>;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  collaboratorLabel: (user: CollaborationUser) => string;
}) {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "dir") {
          const isCollapsed = collapsed.has(node.path);
          return (
            <div key={`dir:${node.path}`} className="file-tree-branch">
              <button
                type="button"
                className="file-row is-directory"
                style={{ "--file-depth": depth } as CSSProperties}
                onClick={() => onToggle(node.path)}
                title={node.path}
                aria-expanded={!isCollapsed}
              >
                {isCollapsed ? (
                  <ChevronRight className="file-chevron" aria-hidden="true" />
                ) : (
                  <ChevronDown className="file-chevron" aria-hidden="true" />
                )}
                {isCollapsed ? (
                  <Folder className="file-folder" aria-hidden="true" />
                ) : (
                  <FolderOpen className="file-folder" aria-hidden="true" />
                )}
                <span className="file-label">{node.name}</span>
              </button>
              {!isCollapsed ? (
                <TreeRows
                  nodes={node.children}
                  depth={depth + 1}
                  openPath={openPath}
                  collapsed={collapsed}
                  presenceByPath={presenceByPath}
                  onToggle={onToggle}
                  onOpen={onOpen}
                  collaboratorLabel={collaboratorLabel}
                />
              ) : null}
            </div>
          );
        }

        const presence = presenceByPath.get(node.path) ?? [];
        return (
          <button
            key={node.path}
            type="button"
            className={`file-row is-file ${openPath === node.path ? "active" : ""}`}
            style={{ "--file-depth": depth } as CSSProperties}
            onClick={() => onOpen(node.path)}
            title={node.path}
          >
            <span className="file-chevron-spacer" aria-hidden="true" />
            <FileIcon path={node.path} />
            <span className="file-label">{node.name}</span>
            {node.status ? <i>{node.status}</i> : null}
            {presence.length > 0 ? (
              <span className="file-presence" aria-label="Active editors">
                {presence.slice(0, 3).map((collaborator) => (
                  <b
                    key={collaborator.id}
                    title={`${collaboratorLabel(collaborator)} is editing`}
                    style={
                      {
                        "--presence-color": collaborator.color,
                      } as CSSProperties
                    }
                  />
                ))}
              </span>
            ) : null}
          </button>
        );
      })}
    </>
  );
}

export function FileExplorer({
  files,
  loading,
  repositoryName,
  openPath,
  presenceByPath,
  onOpen,
  collaboratorLabel,
}: {
  files: WorkspaceFile[];
  loading: boolean;
  repositoryName: string;
  openPath?: string | undefined;
  presenceByPath: Map<string, CollaborationUser[]>;
  onOpen: (path: string) => void;
  collaboratorLabel: (user: CollaborationUser) => string;
}) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [rootCollapsed, setRootCollapsed] = useState(false);

  useEffect(() => {
    if (!openPath) return;
    setCollapsed((current) => {
      const next = new Set(current);
      const segments = openPath.split("/").filter(Boolean);
      for (let index = 1; index < segments.length; index += 1) {
        next.delete(segments.slice(0, index).join("/"));
      }
      return next;
    });
    setRootCollapsed(false);
  }, [openPath]);

  function toggle(path: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function collapseAll() {
    setCollapsed(new Set(collectDirectoryPaths(tree)));
    setRootCollapsed(true);
  }

  function expandAll() {
    setCollapsed(new Set());
    setRootCollapsed(false);
  }

  return (
    <div className="file-explorer">
      <div className="repository-heading">
        <button
          type="button"
          className="repository-heading-toggle"
          onClick={() => setRootCollapsed((value) => !value)}
          aria-expanded={!rootCollapsed}
        >
          {rootCollapsed ? (
            <ChevronRight aria-hidden="true" />
          ) : (
            <ChevronDown aria-hidden="true" />
          )}
          <strong>{repositoryName}</strong>
        </button>
        <div className="repository-heading-actions">
          <button type="button" onClick={expandAll} title="Expand all folders">
            Expand
          </button>
          <button
            type="button"
            onClick={collapseAll}
            title="Collapse all folders"
          >
            Collapse
          </button>
        </div>
      </div>
      <div className="file-tree">
        {loading ? <p className="ide-empty">Loading files…</p> : null}
        {!loading && !rootCollapsed ? (
          <TreeRows
            nodes={tree}
            depth={0}
            openPath={openPath}
            collapsed={collapsed}
            presenceByPath={presenceByPath}
            onToggle={toggle}
            onOpen={onOpen}
            collaboratorLabel={collaboratorLabel}
          />
        ) : null}
        {!loading && files.length === 0 ? (
          <p className="ide-empty">No files in this workspace.</p>
        ) : null}
      </div>
    </div>
  );
}
