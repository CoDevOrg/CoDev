import { describe, expect, it } from "vitest";
import type { Gen2SupersetEntry } from "@codev/contracts";

import { matchComposerFiles } from "./chat-file-match";

const file = (path: string): Gen2SupersetEntry => ({
  path,
  kind: "file",
  size: 1,
});

describe("matchComposerFiles", () => {
  const entries = [
    file("docs/api-notes.md"),
    file("src/lib/api.ts"),
    file("src/app.ts"),
    file("api/server.ts"),
    file("README.md"),
  ];

  it("ranks file names that start with the query, then paths, then any match", () => {
    expect(
      matchComposerFiles(entries, "api", 10).map((entry) => entry.path),
    ).toEqual(["src/lib/api.ts", "docs/api-notes.md", "api/server.ts"]);
  });

  it("is case-insensitive, ignores surrounding space and honors the limit", () => {
    expect(matchComposerFiles(entries, " README ", 10)).toEqual([
      file("README.md"),
    ]);
    expect(matchComposerFiles(entries, "", 2)).toHaveLength(2);
  });
});
