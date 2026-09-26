import { afterEach, describe, expect, it } from "vitest";

import { isGen2SupersetFilePaneEnabled } from "./superset-file-feature";

const originalFlag = process.env.CODEV_SUPERSET_FILE_PANE_ENABLED;

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.CODEV_SUPERSET_FILE_PANE_ENABLED;
  } else {
    process.env.CODEV_SUPERSET_FILE_PANE_ENABLED = originalFlag;
  }
});

describe("isGen2SupersetFilePaneEnabled", () => {
  it("requires an explicit opt-in", () => {
    delete process.env.CODEV_SUPERSET_FILE_PANE_ENABLED;
    expect(isGen2SupersetFilePaneEnabled()).toBe(false);

    process.env.CODEV_SUPERSET_FILE_PANE_ENABLED = "false";
    expect(isGen2SupersetFilePaneEnabled()).toBe(false);

    process.env.CODEV_SUPERSET_FILE_PANE_ENABLED = "true";
    expect(isGen2SupersetFilePaneEnabled()).toBe(true);
  });
});
