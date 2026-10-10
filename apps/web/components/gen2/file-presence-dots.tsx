"use client";

import type { CSSProperties } from "react";

import { agentLabel } from "./agent-label";
import { memberColor } from "./member-color";
import type { FilePresence } from "./use-workspace-presence";

const MAX_DOTS = 3;

function describe(entry: FilePresence[number]) {
  if (entry.kind === "agent")
    return agentLabel(
      entry.agent.provider,
      entry.agent.owner.name || entry.agent.owner.login,
    );
  return entry.person.user.name || entry.person.user.login;
}

/** Everyone presence merged under a folder, one entry per person or agent. */
export function presenceUnder(
  byPath: Map<string, FilePresence>,
  folder: string,
): FilePresence {
  const merged = new Map<string, FilePresence[number]>();
  for (const [path, entries] of byPath)
    if (path.startsWith(`${folder}/`))
      for (const entry of entries) merged.set(entry.id, entry);
  return [...merged.values()];
}

/**
 * Small coloured dots for who else (or which agent) is in a file, in the
 * same colours as their avatars and cursors.
 */
export function FilePresenceDots({
  entries,
}: {
  entries?: FilePresence | undefined;
}) {
  if (!entries?.length) return null;
  const names = entries.map(describe);
  return (
    <span
      className="gen2-file-presence"
      role="img"
      aria-label={`Here: ${names.join(", ")}`}
      title={names.join("\n")}
    >
      {entries.slice(0, MAX_DOTS).map((entry) => (
        <span
          key={entry.id}
          className="gen2-file-presence-dot"
          data-kind={entry.kind}
          style={
            { "--member-color": memberColor(entry.id).color } as CSSProperties
          }
        />
      ))}
    </span>
  );
}
