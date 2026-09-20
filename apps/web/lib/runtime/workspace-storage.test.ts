import { describe, expect, it } from "vitest";

import { selectWorkspaceDiskLun } from "./workspace-storage";

describe("workspace managed-disk placement", () => {
  it("leaves the host's bootstrap disk LUN untouched", () => {
    expect(selectWorkspaceDiskLun([0])).toBe(1);
  });

  it("chooses the first free LUN and skips occupied slots", () => {
    expect(selectWorkspaceDiskLun([0, 1, 2, 4])).toBe(3);
  });

  it("fails cleanly when a host has no data-disk capacity", () => {
    expect(() =>
      selectWorkspaceDiskLun(Array.from({ length: 64 }, (_, i) => i)),
    ).toThrow("no free data-disk LUNs");
  });
});
