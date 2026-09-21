"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { parseGitStatus } from "@/lib/runtime/ide";
import { gen2StatusLabel } from "@/lib/gen2/file-tree";

type GitState = {
  branch: string | null;
  files: { path: string; status: string }[];
};

function parseBranch(output: string): string | null {
  const header = output.split("\n")[0] ?? "";
  if (!header.startsWith("## ")) return null;
  const name = header.slice(3).split("...")[0]?.trim();
  if (!name) return null;
  return name.startsWith("No commits yet on ") ? name.slice(18) : name;
}

/**
 * The one panel that stays live during a Codex turn: the guest serves
 * `git status` and `git diff` without waiting for the agent to go idle, so
 * this is a real-time window into what it is changing.
 */
export function Gen2GitPanel({
  workspaceId,
  visible,
  agentRunning,
  refreshToken,
  onOpenFile,
}: {
  workspaceId: string;
  visible: boolean;
  agentRunning: boolean;
  refreshToken: number;
  onOpenFile: (path: string) => void;
}) {
  const [state, setState] = useState<GitState>({ branch: null, files: [] });
  const [diff, setDiff] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    // `status` and `diff` are the only guest endpoints that answer while a
    // Codex turn holds the mutation lock, so this panel can stay live.
    setLoading(true);
    try {
      const [statusResponse, diffResponse] = await Promise.all([
        fetch(`/api/gen2/workspaces/${workspaceId}/git?operation=status`),
        fetch(`/api/gen2/workspaces/${workspaceId}/git?operation=diff`),
      ]);
      if (!statusResponse.ok) {
        const payload = (await statusResponse.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(payload.error ?? "Couldn't read the Git status.");
        return;
      }
      const status = ((await statusResponse.json()) as { output: string })
        .output;
      setState({
        branch: parseBranch(status),
        files: [...parseGitStatus(status)].map(([path, code]) => ({
          path,
          status: code,
        })),
      });
      setDiff(
        diffResponse.ok
          ? ((await diffResponse.json()) as { output: string }).output
          : "",
      );
      setError("");
    } catch {
      setError("Couldn't reach CoDev. Try again.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    // Fetch-on-mount. apps/web has no data-fetching library, so an effect
    // is where a client component loads from its own API; these updates
    // land in an async continuation, which the rule cannot see.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (visible) void load();
  }, [visible, refreshToken, load]);

  // While the agent works, poll — this is the cheapest honest view of its
  // progress, and the guest is happy to answer.
  useEffect(() => {
    if (!visible || !agentRunning) return;
    const timer = window.setInterval(() => void load(), 4_000);
    return () => window.clearInterval(timer);
  }, [visible, agentRunning, load]);

  return (
    <div className="gen2-git">
      <header className="gen2-wb-subbar">
        <span className="gen2-git-branch">{state.branch ?? "no branch"}</span>
        <span className="gen2-wb-hint">
          {state.files.length === 0
            ? "No changes"
            : `${state.files.length} changed`}
        </span>
        <button
          type="button"
          className="gen2-wb-icon-button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh Git status"
        >
          <RefreshCw aria-hidden="true" size={13} />
        </button>
      </header>

      {error ? (
        <p className="gen2-wb-banner gen2-wb-banner-error" role="alert">
          {error}
        </p>
      ) : null}

      {state.files.length > 0 ? (
        <ul className="gen2-git-files">
          {state.files.map((file) => (
            <li key={file.path}>
              <button
                type="button"
                className="gen2-tree-row"
                onClick={() => onOpenFile(file.path)}
              >
                <span
                  className="gen2-tree-status"
                  data-status={file.status}
                  title={gen2StatusLabel(file.status)}
                >
                  {file.status}
                </span>
                <span className="gen2-tree-name">{file.path}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {diff.trim() ? (
        <pre className="gen2-diff" aria-label="Working tree diff">
          {diff.split("\n").map((line, index) => (
            <span
              key={index}
              className="gen2-diff-line"
              data-kind={diffLineKind(line)}
            >
              {line || " "}
            </span>
          ))}
        </pre>
      ) : (
        <p className="gen2-wb-empty">
          {state.files.length > 0
            ? "New files have no diff until they are added to Git."
            : "The working tree is clean."}
        </p>
      )}
    </div>
  );
}

function diffLineKind(line: string) {
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  if (line.startsWith("diff ") || line.startsWith("index ")) return "meta";
  return "context";
}
