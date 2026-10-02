import { afterEach, expect, it, vi } from "vitest";
import { boundedJsonRequest } from "./bounded-request";
afterEach(() => vi.useRealTimers());
it("bounds a response whose body never finishes and aborts its request", async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValue({ json: () => new Promise(() => {}) });
  const pending = boundedJsonRequest("/workspace", {}, 1000, fetcher);
  const rejected = expect(pending).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(1000);
  await rejected;
  expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
