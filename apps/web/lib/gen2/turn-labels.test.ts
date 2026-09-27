import { describe, expect, it } from "vitest";

import {
  formatWorkedDuration,
  summarizeGen2Command,
  unwrapShellCommand,
} from "./turn-labels";

describe("turn labels", () => {
  it("unwraps bash -lc wrappers", () => {
    expect(
      unwrapShellCommand(
        `/bin/bash -lc "sed -n '1,240p' .codev/uploads/CODEV_FEATURES.md"`,
      ),
    ).toBe("sed -n '1,240p' .codev/uploads/CODEV_FEATURES.md");
  });

  it("summarizes common shell patterns", () => {
    expect(
      summarizeGen2Command(
        `/bin/bash -lc "sed -n '1,240p' .codev/uploads/CODEV_FEATURES.md"`,
      ),
    ).toBe("Read CODEV_FEATURES.md");
    expect(summarizeGen2Command("pnpm test")).toBe("Ran pnpm");
    expect(summarizeGen2Command("ls -la")).toBe("Listed files");
    expect(summarizeGen2Command("rg TODO src")).toBe("Searched files");
    expect(summarizeGen2Command("git status")).toBe("Git status");
  });

  it("formats worked duration like Cursor", () => {
    expect(formatWorkedDuration(0)).toBe("Worked briefly");
    expect(formatWorkedDuration(1)).toBe("Worked for 1s");
    expect(formatWorkedDuration(54)).toBe("Worked for 54s");
    expect(formatWorkedDuration(90)).toBe("Worked for 1m 30s");
  });
});
