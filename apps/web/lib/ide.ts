export interface WorkspaceFile {
  path: string;
  status?: string;
}

export interface SearchMatch {
  path: string;
  line: number;
  preview: string;
}

const ignoredDirectories = new Set([
  ".git",
  ".next",
  "node_modules",
  "target",
  "dist",
  "coverage",
]);

export function parseFileList(output: string): WorkspaceFile[] {
  return output
    .split("\n")
    .map((path) => path.replace(/^\.\//, "").trim())
    .filter(Boolean)
    .filter(
      (path) =>
        !path
          .split("/")
          .some((segment) => ignoredDirectories.has(segment)),
    )
    .sort((left, right) => left.localeCompare(right))
    .map((path) => ({ path }));
}

export function parseGitStatus(output: string) {
  const statuses = new Map<string, string>();
  for (const line of output.split("\n").slice(1)) {
    if (line.length < 4) continue;
    const status = line.slice(0, 2).trim();
    const rawPath = line.slice(3).trim();
    const path = rawPath.includes(" -> ")
      ? rawPath.split(" -> ").at(-1)!
      : rawPath;
    if (path) statuses.set(path, status || "M");
  }
  return statuses;
}

export function attachGitStatus(
  files: WorkspaceFile[],
  output: string,
): WorkspaceFile[] {
  const statuses = parseGitStatus(output);
  return files.map((file) => {
    const status = statuses.get(file.path);
    return status ? { ...file, status } : file;
  });
}

export function parseSearchMatches(output: string): SearchMatch[] {
  return output
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const match = /^(.+?):(\d+):(.*)$/.exec(line);
      if (!match) return [];
      return [
        {
          path: match[1]!,
          line: Number(match[2]),
          preview: match[3]!.trim(),
        },
      ];
    });
}

export function languageForPath(path: string) {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return (
    {
      css: "css",
      go: "go",
      html: "html",
      js: "javascript",
      json: "json",
      jsx: "javascript",
      md: "markdown",
      py: "python",
      rs: "rust",
      sh: "shell",
      sql: "sql",
      ts: "typescript",
      tsx: "typescript",
      yaml: "yaml",
      yml: "yaml",
    }[extension ?? ""] ?? "plaintext"
  );
}
