import type { Gen2FileEntry } from "@codev/contracts";

/**
 * The guest reports a flat list of paths (`find . -type f`), which is what the
 * orchestrator can produce cheaply. The tree is assembled here so it stays a
 * pure function the node test project can cover, rather than logic tangled
 * into a component.
 */

export type Gen2TreeNode =
  | { kind: "file"; name: string; path: string; status: string | null }
  | {
      kind: "directory";
      name: string;
      path: string;
      children: Gen2TreeNode[];
      /** A directory is marked when anything beneath it changed. */
      changed: boolean;
    };

export function buildGen2FileTree(entries: Gen2FileEntry[]): Gen2TreeNode[] {
  const root: Gen2TreeNode[] = [];
  const directories = new Map<
    string,
    Extract<Gen2TreeNode, { kind: "directory" }>
  >();

  for (const entry of [...entries].sort((a, b) =>
    a.path.localeCompare(b.path),
  )) {
    const segments = entry.path.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    let siblings = root;
    let prefix = "";

    for (const segment of segments.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let directory = directories.get(prefix);
      if (!directory) {
        directory = {
          kind: "directory",
          name: segment,
          path: prefix,
          children: [],
          changed: false,
        };
        directories.set(prefix, directory);
        siblings.push(directory);
      }
      if (entry.status) directory.changed = true;
      siblings = directory.children;
    }

    siblings.push({
      kind: "file",
      name: segments.at(-1)!,
      path: entry.path,
      status: entry.status,
    });
  }

  return sortNodes(root);
}

/** Directories first, then files, each alphabetically — the usual reading order. */
function sortNodes(nodes: Gen2TreeNode[]): Gen2TreeNode[] {
  for (const node of nodes) {
    if (node.kind === "directory") sortNodes(node.children);
  }
  return nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

/** Every directory on the way to `path`, for revealing a file in the tree. */
export function ancestorDirectories(path: string): string[] {
  const segments = path.split("/").filter(Boolean).slice(0, -1);
  const result: string[] = [];
  let prefix = "";
  for (const segment of segments) {
    prefix = prefix ? `${prefix}/${segment}` : segment;
    result.push(prefix);
  }
  return result;
}

const STATUS_LABELS: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  "??": "Untracked",
  U: "Conflicted",
};

export function gen2StatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? STATUS_LABELS[status.trim()] ?? "Changed";
}
