import { describe, expect, it } from "vitest";

import { scanLocalSessions } from "./session-import-scan";
import { summarizeLocalSession } from "./session-import-summary";

const MAIN = "01a0fb8e-879a-7a12-8eeb-e52297ff6ffa";
const GUARDIAN = "01a0fb8e-0000-7000-8000-000000000001";
const CLAUDE = "ed1d5840-87cc-4300-a4da-2733bbe91003";
const jsonl = (...lines: unknown[]) =>
  lines.map((line) => JSON.stringify(line)).join("\n");

const codexRollout = (id: string, prompt: string, extra = {}) =>
  jsonl(
    {
      type: "session_meta",
      timestamp: "2026-10-08T10:00:00Z",
      payload: {
        id,
        timestamp: "2026-10-08T10:00:00Z",
        git: { branch: "main" },
        ...extra,
      },
    },
    {
      type: "event_msg",
      payload: {
        type: "item_completed",
        item: {
          type: "UserMessage",
          id: "u",
          content: [{ type: "text", text: prompt }],
        },
      },
    },
  );
const claudeTranscript = (prompt: string, sidechain = false) =>
  jsonl(
    {
      type: "user",
      sessionId: CLAUDE,
      uuid: "u1",
      parentUuid: null,
      isSidechain: sidechain,
      timestamp: "2026-10-08T10:00:00Z",
      gitBranch: "feature",
      message: { content: prompt },
    },
    { type: "custom-title", sessionId: CLAUDE, customTitle: "Renamed session" },
  );

type Tree = { [name: string]: Tree | File };
const file = (name: string, text: string, modified: number) =>
  new File([text], name, { lastModified: modified });

// The slice of FileSystemDirectoryHandle the scanner uses.
function directory(name: string, tree: Tree): FileSystemDirectoryHandle {
  const child = (entryName: string, entry: Tree | File) =>
    entry instanceof File
      ? { kind: "file", name: entryName, getFile: async () => entry }
      : directory(entryName, entry);
  return {
    kind: "directory",
    name,
    async *values() {
      for (const [entryName, entry] of Object.entries(tree)) {
        yield child(entryName, entry);
      }
    },
    async getDirectoryHandle(entryName: string) {
      const entry = tree[entryName];
      if (!entry || entry instanceof File)
        throw new DOMException("", "NotFoundError");
      return directory(entryName, entry);
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe("local session browser", () => {
  it("lists Codex sessions newest first and hides sub-agents", async () => {
    const home = directory(".codex", {
      "config.toml": file("config.toml", "", 1),
      sessions: {
        "2026": {
          "10": {
            "07": {
              "rollout-a.jsonl": file(
                "rollout-a.jsonl",
                codexRollout(MAIN, "Older work"),
                100,
              ),
            },
            "08": {
              "rollout-b.jsonl": file(
                "rollout-b.jsonl",
                codexRollout(MAIN, "Newer work"),
                300,
              ),
              "rollout-c.jsonl": file(
                "rollout-c.jsonl",
                codexRollout(GUARDIAN, ">>> APPROVAL REQUEST START", {
                  source: { subagent: { other: "guardian" } },
                }),
                400,
              ),
            },
          },
        },
      },
    });
    const sessions = await scanLocalSessions(home as never, "codex");
    expect(sessions.map((s) => [s.title, s.branch, s.file.name])).toEqual([
      ["Newer work", "main", "rollout-b.jsonl"],
      ["Older work", "main", "rollout-a.jsonl"],
    ]);
  });

  it("lists Claude sessions and skips sub-agent folders", async () => {
    const projects = directory("projects", {
      "c--repo": {
        [`${CLAUDE}.jsonl`]: file(
          `${CLAUDE}.jsonl`,
          claudeTranscript("Fix it"),
          200,
        ),
        [CLAUDE]: {
          subagents: {
            "agent-1.jsonl": file(
              "agent-1.jsonl",
              claudeTranscript("Sub", true),
              500,
            ),
          },
        },
      },
    });
    const sessions = await scanLocalSessions(projects as never, "claude");
    expect(sessions.map((s) => [s.title, s.branch])).toEqual([
      ["Renamed session", "feature"],
    ]);
  });

  it("summarizes heads whose first prompt was cut off, and rejects non-sessions", () => {
    const header = codexRollout(MAIN, "x").split("\n")[0]!;
    expect(summarizeLocalSession("codex", header)).toMatchObject({
      title: "Untitled session",
    });
    expect(summarizeLocalSession("codex", "not a session")).toBeNull();
    expect(
      summarizeLocalSession("claude", claudeTranscript("Sub", true)),
    ).toBeNull();
  });
});
