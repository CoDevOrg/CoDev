import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkRealtimeConnection } = vi.hoisted(() => ({
  checkRealtimeConnection: vi.fn(),
}));

vi.mock("@/lib/collaboration-server", () => ({
  checkRealtimeConnection,
}));

import { GET } from "@/app/api/health/realtime/route";

describe("realtime health endpoint", () => {
  beforeEach(() => {
    checkRealtimeConnection.mockReset();
  });

  it("reports a healthy Redis connection without exposing details", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "codev-realtime",
    });
  });

  it("returns a generic unavailable response", async () => {
    checkRealtimeConnection.mockRejectedValueOnce(
      new Error("redis://secret-host"),
    );
    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      service: "codev-realtime",
    });
  });
});
