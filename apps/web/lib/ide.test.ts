import { describe, expect, it } from "vitest";

import {
  attachGitStatus,
  languageForPath,
  parseFileList,
  parseSearchMatches,
} from "./ide";

describe("IDE payload parsing", () => {
  it("sorts files and removes generated trees", () => {
    expect(
      parseFileList(
        "./src/main.rs\n./node_modules/pkg/index.js\n./README.md\n./target/debug/app\n",
      ),
    ).toEqual([{ path: "README.md" }, { path: "src/main.rs" }]);
  });

  it("attaches porcelain Git states, including renames", () => {
    expect(
      attachGitStatus(
        [{ path: "src/new.ts" }, { path: "src/changed.ts" }],
        "## main\nR  src/old.ts -> src/new.ts\n M src/changed.ts\n",
      ),
    ).toEqual([
      { path: "src/new.ts", status: "R" },
      { path: "src/changed.ts", status: "M" },
    ]);
  });

  it("parses ripgrep output and resolves editor languages", () => {
    expect(parseSearchMatches("src/a.ts:12:const codev = true;\n")).toEqual([
      { path: "src/a.ts", line: 12, preview: "const codev = true;" },
    ]);
    expect(languageForPath("services/runtime/src/main.rs")).toBe("rust");
    expect(languageForPath("LICENSE")).toBe("plaintext");
  });
});
