import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: vi.fn(),
  realtime: vi.fn(),
  host: vi.fn(),
}));

vi.mock("../platform/database", () => ({
  checkDatabaseConnection: mocks.database,
}));
vi.mock("../gen2/collaboration-redis", () => ({
  checkRealtimeConnection: mocks.realtime,
}));
vi.mock("./host", () => ({ getHostState: mocks.host }));

import { getReadiness } from "./readiness";

describe("web service readiness", () => {
  beforeEach(() => {
    mocks.database.mockReset().mockResolvedValue(undefined);
    mocks.realtime.mockReset().mockResolvedValue(undefined);
    mocks.host.mockReset().mockRejectedValue(new Error("host retired"));
  });

  it("remains ready without a Firecracker host or running workspace", async () => {
    const result = await getReadiness();

    expect(result.status).toBe("ready");
    expect(result.components.database.status).toBe("ready");
    expect(result.components.realtime.status).toBe("ready");
    expect(mocks.host).not.toHaveBeenCalled();
  });

  it.each(["database", "realtime"] as const)(
    "reports degraded when %s is unavailable",
    async (dependency) => {
      mocks[dependency].mockRejectedValue(new Error("dependency unavailable"));

      const result = await getReadiness();

      expect(result.status).toBe("degraded");
      expect(result.components[dependency].status).toBe("degraded");
    },
  );
});
