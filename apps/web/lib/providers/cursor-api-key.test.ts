import { describe, expect, it, vi } from "vitest";

import { verifyCursorApiKey } from "./cursor-api-key";

function response(status: number) {
  return new Response("{}", { status });
}

describe("verifyCursorApiKey", () => {
  it("accepts a key Cursor's identity endpoint confirms", async () => {
    const fetchImpl = vi.fn(async () => response(200));
    await expect(
      verifyCursorApiKey("cursor_test_key_value_0001", fetchImpl),
    ).resolves.toBe("cursor_test_key_value_0001");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects a key Cursor refuses, without calling the fallback", async () => {
    const fetchImpl = vi.fn(async () => response(401));
    await expect(
      verifyCursorApiKey("cursor_test_key_value_0001", fetchImpl),
    ).rejects.toThrow(/rejected/i);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("tries the legacy identity endpoint when the current one is missing", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(200));
    await expect(
      verifyCursorApiKey("cursor_test_key_value_0001", fetchImpl),
    ).resolves.toBe("cursor_test_key_value_0001");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refuses a key that is too short before calling Cursor", async () => {
    const fetchImpl = vi.fn();
    await expect(verifyCursorApiKey("short", fetchImpl)).rejects.toThrow(
      /valid Cursor API key/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
