import { describe, expect, it } from "vitest";

import { buildGen2AgentCommand } from "./agent-command";
import { formatGen2WorkspaceAgentPrompt } from "./workspace-agent-instructions";

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

  it.each(["codex", "claude", "cursor"] as const)(
    "puts %s's turn context before the conversation and the prompt last",
    (provider) => {
      const command = buildGen2AgentCommand(
        provider,
        "Describe this environment",
        [{ role: "user", body: "Inspect the project first" }],
        "account-model",
        "Mode: ask. Answer the member's question.",
      );
      const prompt = command.at(-1)!;

      expect(prompt.indexOf("CoDev workspace")).toBeLessThan(
        prompt.indexOf("Mode: ask."),
      );
      expect(prompt.indexOf("Mode: ask.")).toBeLessThan(
        prompt.indexOf("Previous conversation on this chat:"),
      );
      expect(
        prompt.endsWith("Current request:\nDescribe this environment"),
      ).toBe(true);
      // The flags the guest allowlist pins are unchanged.
      expect(command.slice(0, -1)).toEqual(
        buildGen2AgentCommand(provider, "x", [], "account-model").slice(0, -1),
      );
    },
  );

  it("marks the request whenever context comes before it", () => {
    const prompt = formatGen2WorkspaceAgentPrompt(
      "Add tests",
      [],
      "Mode: plan. The member asked for a plan, not changes.",
    );
    expect(
      prompt.endsWith(
        "Mode: plan. The member asked for a plan, not changes.\n\nCurrent request:\nAdd tests",
      ),
    ).toBe(true);
  });

  it("leaves a turn without context as it was", () => {
    expect(formatGen2WorkspaceAgentPrompt("Add tests", [], "")).toBe(
      formatGen2WorkspaceAgentPrompt("Add tests"),
    );
    expect(formatGen2WorkspaceAgentPrompt("Add tests")).not.toContain(
      "Current request:",
    );
  });
});
