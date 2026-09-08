import { describe, expect, it, vi } from "vitest";
import { WorkspaceOpenTiming } from "./workspace-open-timing";

describe("workspace open timing", () => {
  it("reports durations without operation results and disables response caching", async () => {
    const now = vi
      .spyOn(performance, "now")
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(35);
    try {
      const timing = new WorkspaceOpenTiming();
      expect(
        await timing.measure("connect", async () => "private-pairing"),
      ).toBe("private-pairing");
      expect(timing.headers()).toEqual({
        "Cache-Control": "no-store",
        "Server-Timing": "connect;dur=25.0",
      });
    } finally {
      now.mockRestore();
    }
  });

  it("records failed stages without swallowing or exposing the error", async () => {
    const timing = new WorkspaceOpenTiming();
    await expect(
      timing.measure("host", async () => {
        throw new Error("private error");
      }),
    ).rejects.toThrow("private error");
    expect(timing.headers()["Server-Timing"]).toMatch(/^host;dur=\d+\.\d$/);
  });
});
