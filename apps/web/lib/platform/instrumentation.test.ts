import { afterEach, expect, it, vi } from "vitest";
import { register } from "../../instrumentation";

const start = vi.hoisted(() => vi.fn());
vi.mock("workflow/runtime", () => ({ getWorld: () => ({ start }) }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("keeps HTTP startup available while retrying a failed durable queue", async () => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("WORKFLOW_TARGET_WORLD", "@workflow/world-postgres");
  vi.spyOn(console, "error").mockImplementation(() => {});
  start
    .mockRejectedValueOnce(new Error("session pool unavailable"))
    .mockResolvedValueOnce(undefined);
  await expect(register()).resolves.toBeUndefined();
  expect(start).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(start).toHaveBeenCalledTimes(2);
});
