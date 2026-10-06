import { describe, expect, it } from "vitest";

import { buildGen2AgentCommand } from "./agent-command";

describe("workspace agent instructions", () => {
  it.each(["codex", "claude", "cursor"] as const)(
    "gives %s the shared workspace contract",
    (provider) => {
      const command = buildGen2AgentCommand(
        provider,
        "Describe this environment",
        [{ role: "user", body: "Inspect the project first" }],
      );
      const prompt = command.at(-1);

      expect(prompt).toContain(
        "AI coding agent working inside a CoDev workspace",
      );
      expect(prompt).toContain("active project checkout or worktree");
      expect(prompt).toContain("Files under /workspace are durable");
      expect(prompt).toContain(".codev-runtime or lost+found");
      expect(prompt).toContain("protected CoDev-managed files");
      expect(prompt).toContain(
        "Do not inspect environment variables, CODEX_HOME",
      );
      expect(prompt).toContain("Inspect the project first");
      expect(prompt).toContain("Describe this environment");
    },
  );
});
