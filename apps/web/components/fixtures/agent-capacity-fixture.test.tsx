import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentCapacityFixture } from "./agent-capacity-fixture";

describe("AgentCapacityFixture", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "agent_capacity_exceeded",
            error:
              "All three agent slots are in use. Stop or wait for an active session to finish before starting another.",
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        ),
      ),
    );
  });

  it("renders the actionable server rejection for a fourth session", async () => {
    render(<AgentCapacityFixture />);

    fireEvent.click(
      screen.getByRole("button", { name: "Start fourth session" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Server rejected the fourth session · HTTP 409",
      );
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Stop or wait for an active session to finish",
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/verification/b0-2/agent-capacity",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
