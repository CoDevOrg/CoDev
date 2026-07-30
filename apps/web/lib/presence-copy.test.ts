import { describe, expect, it } from "vitest";

import { formatPresenceCopy } from "./presence-copy";

describe("formatPresenceCopy", () => {
  it("describes empty and single-person rooms", () => {
    expect(formatPresenceCopy(0)).toBe("Just you");
    expect(formatPresenceCopy(1)).toBe("1 person here");
  });

  it("pluralizes multi-person rooms", () => {
    expect(formatPresenceCopy(2)).toBe("2 people here");
    expect(formatPresenceCopy(5)).toBe("5 people here");
  });
});
