import { describe, expect, it } from "vitest";

import {
  GEN2_BLANK_BASE_SHA,
  GEN2_SANDBOX_LIFECYCLE,
  buildBlankSandboxSource,
  canStartInstance,
  canStopInstance,
  describeGen2RuntimeFailure,
} from "./instance";

describe("gen2 Firecracker instance policy", () => {
  it("uses a blank snapshot so the orchestrator gets exactly one repository source", () => {
    const source = buildBlankSandboxSource();
    expect(source.repositoryUrl).toBeNull();
    expect(source.baseSha).toBe(GEN2_BLANK_BASE_SHA);
    expect(source.baseSha).toHaveLength(40);
    expect(source.repositorySnapshot.files).toEqual([
      expect.objectContaining({ path: "README.md", mode: "100644" }),
    ]);
    expect(source.repositorySnapshot.totalBytes).toBeGreaterThan(0);
  });

  it("uses the four-hour pause lifecycle the orchestrator requires", () => {
    expect(GEN2_SANDBOX_LIFECYCLE).toEqual({
      timeoutMs: 14_400_000,
      lifecycle: { onTimeout: "pause", autoResume: true },
    });
  });

  it("only starts a stopped, failed, or never-started instance", () => {
    expect(canStartInstance("pending")).toBe(true);
    expect(canStartInstance("failed")).toBe(true);
    expect(canStartInstance("stopped")).toBe(true);
    expect(canStartInstance("ready")).toBe(false);
    expect(canStartInstance("provisioning")).toBe(false);
  });

  it("only stops a live or starting instance", () => {
    expect(canStopInstance("ready")).toBe(true);
    expect(canStopInstance("provisioning")).toBe(true);
    expect(canStopInstance("stopped")).toBe(false);
    expect(canStopInstance("pending")).toBe(false);
  });

  it("rewrites host fetch failures into a retryable message", () => {
    expect(describeGen2RuntimeFailure(new TypeError("fetch failed"))).toMatch(
      /try Start instance again/,
    );
    expect(describeGen2RuntimeFailure(new Error("disk full"))).toBe(
      "disk full",
    );
  });
});
