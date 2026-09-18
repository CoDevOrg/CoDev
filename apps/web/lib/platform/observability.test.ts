import { afterEach, describe, expect, it, vi } from "vitest";

import { logEvent, requestId } from "./observability";

afterEach(() => vi.restoreAllMocks());

describe("structured observability", () => {
  it("redacts credentials and sensitive payload fields", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    logEvent("error", "test.failed", {
      authorization: "Bearer secret",
      error: "request failed with sk-example123456789",
      workspaceId: "workspace",
    });

    const record = JSON.parse(String(output.mock.calls[0]?.[0])) as Record<
      string,
      unknown
    >;
    expect(record.authorization).toBe("[REDACTED]");
    expect(record.error).toBe("request failed with [REDACTED]");
    expect(record.workspaceId).toBe("workspace");
  });

  it("propagates a bounded request identifier", () => {
    expect(
      requestId(
        new Request("https://codev.test", {
          headers: { "x-codev-request-id": "request-123" },
        }),
      ),
    ).toBe("request-123");
  });
});
