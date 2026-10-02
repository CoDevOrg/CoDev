import { describe, expect, it } from "vitest";

import {
  GUEST_FILE_LIST_LIMIT,
  repositoryTreeExceedsGuestList,
  repositoryTreeToEntries,
} from "./repository-file-list";

describe("repository file list", () => {
  it("turns a GitHub tree into workspace files and folders", () => {
    expect(
      repositoryTreeToEntries([
        { path: "apps", type: "tree" },
        { path: "apps/web/page.tsx", type: "blob", size: 12 },
        { path: "vendor/lib", type: "commit" },
        { path: ".git/config", type: "blob", size: 4 },
      ]),
    ).toEqual([
      { path: "apps", kind: "directory" },
      { path: "apps/web/page.tsx", kind: "file", size: 12 },
    ]);
  });

  it("uses the repository list only after the guest cap", () => {
    expect(repositoryTreeExceedsGuestList(GUEST_FILE_LIST_LIMIT)).toBe(false);
    expect(repositoryTreeExceedsGuestList(GUEST_FILE_LIST_LIMIT + 1)).toBe(
      true,
    );
  });
});
