import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fakeGuestEnabled: vi.fn(() => false),
  requestHostWake: vi.fn(),
  orchestratorRequest: vi.fn(),
}));

vi.mock("./fake-guest", () => ({
  fakeGuestEnabled: mocks.fakeGuestEnabled,
}));

vi.mock("./host", () => ({
  requestHostWake: mocks.requestHostWake,
}));

vi.mock("./orchestrator-request", () => ({
  OrchestratorError: class OrchestratorError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
  orchestratorRequest: mocks.orchestratorRequest,
  orchestratorRequestAt: vi.fn(),
}));

import { ensureHostReady } from "./orchestrator-health";

describe("ensureHostReady", () => {
  beforeEach(() => {
    mocks.fakeGuestEnabled.mockReturnValue(false);
    mocks.requestHostWake.mockReset().mockResolvedValue("running");
    mocks.orchestratorRequest
      .mockReset()
      .mockResolvedValue(
        Response.json({ status: "ok", service: "codev-orchestrator" }),
      );
  });

  it("leaves stopping-host waits to its bounded health poll loop", async () => {
    await expect(ensureHostReady(1_000)).resolves.toBeUndefined();

    expect(mocks.requestHostWake).toHaveBeenCalledOnce();
    expect(mocks.requestHostWake).toHaveBeenCalledWith(1);
  });
});
