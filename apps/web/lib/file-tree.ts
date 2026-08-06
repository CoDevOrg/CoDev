import type { WorkspaceFile } from "./ide";

export type FileTreeNode =
  | {
      kind: "dir";
      name: string;
      path: string;
      children: FileTreeNode[];
    }
  | {
      kind: "file";
      name: string;
      path: string;
      status?: string;
    };

type MutableDir = {
  kind: "dir";
  name: string;
  path: string;
  dirs: Map<string, MutableDir>;
  files: Map<string, Extract<FileTreeNode, { kind: "file" }>>;
};

function sortNodes(left: FileTreeNode, right: FileTreeNode) {
  if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * Build a nested folder tree from a flat workspace file list (Cursor/VS Code style).
 */
export function buildFileTree(files: WorkspaceFile[]): FileTreeNode[] {
  const root: MutableDir = {
    kind: "dir",
    name: "",
    path: "",
    dirs: new Map(),
    files: new Map(),
  };

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    let current = root;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const name = segments[index]!;
      const path = segments.slice(0, index + 1).join("/");
      let next = current.dirs.get(name);
      if (!next) {
        next = {
          kind: "dir",
          name,
          path,
          dirs: new Map(),
          files: new Map(),
        };
        current.dirs.set(name, next);
      }
      current = next;
    }
    const fileName = segments.at(-1)!;
    current.files.set(fileName, {
      kind: "file",
      name: fileName,
      path: file.path,
      ...(file.status ? { status: file.status } : {}),
    });
  }

  function finalize(node: MutableDir): FileTreeNode[] {
    const children: FileTreeNode[] = [
      ...[...node.dirs.values()].map((dir) => ({
        kind: "dir" as const,
        name: dir.name,
        path: dir.path,
        children: finalize(dir),
      })),
      ...node.files.values(),
    ];
    return children.sort(sortNodes);
  }

  return finalize(root);
}

export function fileExtension(path: string) {
  const base = path.split("/").at(-1) ?? path;
  if (base.startsWith(".") && !base.slice(1).includes(".")) return base;
  const parts = base.split(".");
  return parts.length > 1 ? (parts.at(-1)?.toLowerCase() ?? "") : "";
}

export function collectDirectoryPaths(nodes: FileTreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "dir") continue;
    paths.push(node.path);
    paths.push(...collectDirectoryPaths(node.children));
  }
  return paths;
}

/** Children of a directory path within a built tree (`""` = repository root). */
export function getFileTreeChildrenAt(
  nodes: FileTreeNode[],
  cwd: string,
): FileTreeNode[] {
  if (!cwd) return nodes;
  const segments = cwd.split("/").filter(Boolean);
  let current = nodes;
  for (const segment of segments) {
    const next = current.find(
      (node) => node.kind === "dir" && node.name === segment,
    );
    if (!next || next.kind !== "dir") return [];
    current = next.children;
  }
  return current;
}
