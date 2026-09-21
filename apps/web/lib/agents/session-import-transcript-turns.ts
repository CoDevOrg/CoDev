import type { NormalizedSessionTranscript } from "@codev/contracts";

export type ImportedTurn = {
  prompt: string;
  output: string;
  createdAt: Date;
};

function entryDate(value: string | null, fallback: Date) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function labelEntry(
  entry: NormalizedSessionTranscript[number],
  fallbackLabel: string,
) {
  const label = entry.authorName?.trim() || fallbackLabel;
  return `[${label}]\n${entry.text}`;
}

/** Converts normalized messages into the user/agent turn shape CoDev stores. */
export function importedTranscriptToTurns(
  transcript: NormalizedSessionTranscript,
  importedAt: string,
): ImportedTurn[] {
  const baseDate = entryDate(importedAt, new Date());
  const turns: ImportedTurn[] = [];
  let pendingContext: string[] = [];
  let current:
    | { prompt: string; output: string[]; createdAt: Date }
    | undefined;

  const flush = () => {
    if (!current) return;
    turns.push({
      prompt: current.prompt,
      output:
        current.output.join("\n\n") || "[No agent response was recorded.]",
      createdAt: current.createdAt,
    });
    current = undefined;
  };

  for (const entry of transcript) {
    const fallbackDate = new Date(baseDate.getTime() + entry.sequence);
    if (entry.role === "user") {
      flush();
      const userText = pendingContext.length
        ? `${pendingContext.join("\n\n")}\n\n[User message]\n${entry.text}`
        : entry.text;
      current = {
        prompt: userText,
        output: [],
        createdAt: entryDate(entry.createdAt, fallbackDate),
      };
      pendingContext = [];
      continue;
    }

    const text =
      entry.role === "assistant"
        ? entry.text
        : labelEntry(
            entry,
            entry.role === "system" ? "Imported system context" : "Tool",
          );
    if (current) current.output.push(text);
    else pendingContext.push(text);
  }
  flush();

  if (pendingContext.length) {
    turns.push({
      prompt: "Imported session context",
      output: pendingContext.join("\n\n"),
      createdAt: baseDate,
    });
  }
  return turns;
}
