import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OrcaHostedInspector, OrcaHostedSidebar } from "./orca-hosted-shell";

const session = {
  id: "session-1",
  name: "Build the renderer",
  model: "gpt-5.6",
  provider: "Codex",
  status: "running",
  worktreeName: "codex/orca-renderer",
  worktreeStatus: "active" as const,
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

describe("Orca hosted sidebar", () => {
  it("uses Orca worktree cards to steer the CoDev agent surface", () => {
    const select = vi.fn();
    window.addEventListener("codev:orca-select-session", select, {
      once: true,
    });

    render(
      <OrcaHostedSidebar
        sessions={[session]}
        repository="stablyai/orca"
        branch="main"
        canCreate
      />,
    );
    fireEvent.click(screen.getByText("Build the renderer"));

    expect(select).toHaveBeenCalledOnce();
    expect((select.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      sessionId: "session-1",
    });
  });

  it("routes Orca's new-workspace action to a new CoDev agent session", () => {
    const create = vi.fn();
    window.addEventListener("codev:orca-new-session", create, { once: true });

    render(
      <OrcaHostedSidebar
        sessions={[]}
        repository="stablyai/orca"
        branch="main"
        canCreate
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New workspace" }));

    expect(create).toHaveBeenCalledOnce();
  });

  it("switches between Orca's files, source-control, and agent inspectors", () => {
    render(
      <OrcaHostedInspector
        sourceControl={<div>Changed files</div>}
        agents={<div>Parallel agents</div>}
      >
        <div>File explorer</div>
      </OrcaHostedInspector>,
    );

    expect(screen.getByText("File explorer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /source control/i }));
    expect(screen.getByText("Changed files")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /agents/i }));
    expect(screen.getByText("Parallel agents")).toBeInTheDocument();
  });
});
