import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ update: vi.fn(), limit: vi.fn() }));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.limit }) }) }),
  }),
}));
vi.mock("../providers/cursor-auth-refresh", () => ({
  updateCursorAuthCache: mocks.update,
}));
vi.mock("../platform/observability", () => ({ logEvent: vi.fn() }));

import { refreshCursorTurnAuth } from "./cursor-auth-refresh";

describe("Cursor turn authentication refresh", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  it("refreshes the initiating member rather than the member polling a shared workspace", async () => {
    mocks.limit.mockResolvedValue([{ userId: "initiating-member" }]);
    await refreshCursorTurnAuth("session", "auth-cache");
    expect(mocks.update).toHaveBeenCalledWith(
      "initiating-member",
      "auth-cache",
    );
  });
  it("does not write credentials for an absent Cursor turn", async () => {
    mocks.limit.mockResolvedValue([]);
    await refreshCursorTurnAuth("absent", "auth-cache");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
