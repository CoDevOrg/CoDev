import { afterEach, describe, expect, it, vi } from "vitest";

import { isGen2SupersetRuntimeEnabled } from "./superset-runtime-feature";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isGen2SupersetRuntimeEnabled", () => {
  it("enables the workspace runtime during local development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CODEV_SUPERSET_RUNTIME_ENABLED", undefined);

    expect(isGen2SupersetRuntimeEnabled()).toBe(true);
  });

  it("stays off in production unless explicitly enabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODEV_SUPERSET_RUNTIME_ENABLED", undefined);
    expect(isGen2SupersetRuntimeEnabled()).toBe(false);

    vi.stubEnv("CODEV_SUPERSET_RUNTIME_ENABLED", "true");
    expect(isGen2SupersetRuntimeEnabled()).toBe(true);
  });

  it("honors an explicit disable in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CODEV_SUPERSET_RUNTIME_ENABLED", "false");

    expect(isGen2SupersetRuntimeEnabled()).toBe(false);
  });
});
