import { describe, expect, it } from "vitest";

import { readServerEnvironment } from "./index";

describe("server environment", () => {
  it("allows an empty Phase 1 environment", () => {
    expect(
      readServerEnvironment({ NODE_ENV: "test", DATABASE_URL: "" }),
    ).toEqual({
      NODE_ENV: "test",
      DATABASE_URL: undefined,
    });
  });

  it("rejects malformed service URLs", () => {
    expect(() =>
      readServerEnvironment({
        NODE_ENV: "production",
        ORCHESTRATOR_URL: "not a URL",
      }),
    ).toThrow();
  });
});
