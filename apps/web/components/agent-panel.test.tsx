import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentPanel, type AgentSession } from "./agent-panel";

const session: AgentSession = {
  id: "session-1",
  name: "Improve workspace navigation",
  model: "Codex",
  status: "running",
  worktreeName: "agent/navigation",
  worktreeStatus: "active",
  issueNumber: null,
  issueTitle: null,
  issueUrl: null,
  reviewHeadSha: null,
  reviewBaseSha: null,
  reviewDiffDigest: null,
  reviewedAt: null,
  mergedAt: null,
  discardedAt: null,
  lastError: null,
  claims: [],
  messages: [],
  turns: [],
  events: [],
};

describe("AgentPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps sessions in a sidebar beside the active conversation", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sessions: [session], stateEvents: [] }),
      }),
    );

    render(
      <AgentPanel
        workspaceId="workspace-1"
        canMerge
        initialSessions={[session]}
      />,
    );

    expect(
      screen.getByRole("complementary", { name: "Chat sessions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Agent conversation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Improve workspace navigation/i }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("textbox", {
        name: "Message Improve workspace navigation",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Agent model" })).toHaveValue(
      "Codex",
    );
  });

  it("shows readable labels for the recent GPT model catalog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessions: [],
          stateEvents: [],
          models: [
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
            "gpt-5.5",
            "gpt-5.4",
            "gpt-5.4-mini",
          ],
        }),
      }),
    );

    render(
      <AgentPanel
        workspaceId="workspace-1"
        canMerge
        initialSessions={[{ ...session, model: "gpt-5" }]}
      />,
    );

    expect(
      await screen.findByRole("option", { name: "5.6 Sol" }),
    ).toBeVisible();
    expect(screen.getByRole("option", { name: "5.6 Terra" })).toBeVisible();
    expect(screen.getByRole("option", { name: "5.6 Luna" })).toBeVisible();
    expect(screen.getByRole("option", { name: "5.4 Mini" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Agent model" })).toHaveValue(
      "gpt-5.6-luna",
    );
  });
});
