/**
 * Short, human labels for Codex turn steps — the Cursor-style timeline shows
 * these instead of the raw shell lines.
 */

function basename(path: string): string {
  const cleaned = path.replace(/\\/g, "/");
  const parts = cleaned.split("/");
  return parts[parts.length - 1] || path;
}

/** Peel `/bin/bash -lc '…'` wrappers Codex often emits. */
export function unwrapShellCommand(command: string): string {
  const trimmed = command.trim();
  const match = trimmed.match(
    /^(?:\/bin\/)?(?:ba)?sh\s+-lc\s+(['"])([\s\S]*)\1\s*$/,
  );
  return match?.[2]?.trim() || trimmed;
}

export function summarizeGen2Command(command: string): string {
  const inner = unwrapShellCommand(command);

  const sed = inner.match(/^sed\s+(?:-n\s+)?(?:(['"])[^'"]*\1|[^\s]+)\s+(\S+)/);
  if (sed) return `Read ${basename(sed[2]!)}`;

  const reader = inner.match(/^(?:cat|head|tail|less|more)\s+(\S+)/);
  if (reader) return `Read ${basename(reader[1]!)}`;

  const rg = inner.match(/^(?:rg|grep|ag|ack)\b/);
  if (rg) return "Searched files";

  const find = inner.match(/^find\b/);
  if (find) return "Listed files";

  const ls = inner.match(/^ls\b/);
  if (ls) return "Listed files";

  const git = inner.match(/^git\s+(\S+)/);
  if (git) return `Git ${git[1]}`;

  const first = inner.split(/\s+/)[0] ?? "command";
  const tool = basename(first);
  return `Ran ${tool}`;
}

export function formatWorkedDuration(seconds: number): string {
  if (seconds < 1) return "Worked briefly";
  if (seconds === 1) return "Worked for 1s";
  if (seconds < 60) return `Worked for ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (rest === 0) return `Worked for ${minutes}m`;
  return `Worked for ${minutes}m ${rest}s`;
}
