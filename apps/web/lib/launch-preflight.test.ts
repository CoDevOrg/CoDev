import { describe, expect, it } from "vitest";

import { scaleToZeroStatus } from "./launch-preflight";

describe("launch preflight", () => {
  it("requires a sleeping host when no workspaces are active", () => {
    expect(scaleToZeroStatus(0, "stopped")).toBe("safe");
    expect(scaleToZeroStatus(0, "stopping")).toBe("safe");
    expect(scaleToZeroStatus(0, "running")).toBe("attention");
  });

  it("reports an in-use host while workspaces are active", () => {
    expect(scaleToZeroStatus(1, "running")).toBe("in-use");
  });
});
