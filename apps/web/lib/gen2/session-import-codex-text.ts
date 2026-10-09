/** Field readers shared by the current and legacy Codex rollout readers. */

type UnknownRecord = Record<string, unknown>;

export type CodexLine = {
  type: string;
  timestamp: string | null;
  payload: UnknownRecord;
};

// The VS Code extension wraps a prompt in context sections; this heading
// starts the member's own words.
const REQUEST_HEADING = /^## My request(?: for Codex)?:\s*$/m;

export function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function codexRequestText(text: string): string {
  const match = REQUEST_HEADING.exec(text);
  return match ? text.slice(match.index + match[0].length).trim() : text.trim();
}

/** Text parts of a Codex content array (`text`, `input_text`, `output_text`). */
export function codexContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map(asRecord)
    .filter((part) => /^(?:input_|output_)?text$/i.test(asString(part?.type)))
    .map((part) => asString(part?.text))
    .join("\n");
}

/** A shell invocation as one readable line, without the shell wrapper. */
export function codexCommandText(command: unknown): string {
  if (typeof command === "string") return command;
  if (!Array.isArray(command)) return "";
  const parts = command.map(asString);
  const wrapped =
    parts.length >= 3 && /^-(?:l?c|Command)$/.test(parts.at(-2) ?? "");
  return wrapped ? (parts.at(-1) ?? "") : parts.join(" ");
}

export function codexChangeKind(type: string): "add" | "modify" | "delete" {
  if (/^add/i.test(type)) return "add";
  if (/^delete/i.test(type)) return "delete";
  return "modify";
}
