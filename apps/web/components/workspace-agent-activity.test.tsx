import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkspaceAgentActivityRail } from "./workspace-agent-activity";
import { emptyLiveAgentCards } from "@/lib/live-agent-activity-view";

describe("WorkspaceAgentActivityRail", () => {
  it("shows every agent slot, who started it, and who is working without requiring a click", () => {
    const cards = emptyLiveAgentCards();
    cards[0] = {
      slot: 1,
      occupied: true,
      assignment: "Repository map",
      status: "Running",
      provider: "openai",
      owner: "Alex Morgan",
      working: ["Alex Morgan", "Jordan Lee"],
      currentTask: "Map the repository layout.",
      elapsed: "00:18",
    };
    cards[1] = {
      slot: 2,
      occupied: true,
      assignment: "Presence replay",
      status: "Active",
      provider: "anthropic",
      owner: "Jordan Lee",
      working: ["Jordan Lee"],
      currentTask: "Replay presence.",
      elapsed: "01:42",
    };

    render(<WorkspaceAgentActivityRail cards={cards} occupied={2} max={3} />);

    const rail = screen.getByLabelText("Active agents");
    expect(rail).toBeVisible();
    expect(
      screen.getByLabelText("Active agents: 2 of 3 live"),
    ).toHaveTextContent("2 of 3 live");
    expect(
      screen.getByLabelText(
        "Agent slot 1: Repository map. Started by Alex Morgan. Working: Alex Morgan, Jordan Lee.",
      ),
    ).toBeVisible();
    expect(rail).toHaveTextContent("Started by");
    expect(rail).toHaveTextContent("Alex Morgan");
    expect(rail).toHaveTextContent("Jordan Lee");
    expect(rail).toHaveTextContent("Working");
    expect(screen.getByLabelText("Agent slot 3: available")).toHaveTextContent(
      "No active agent",
    );
  });
});
