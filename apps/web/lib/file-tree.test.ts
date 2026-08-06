import { describe, expect, it } from "vitest";

import {
  buildFileTree,
  collectDirectoryPaths,
  fileExtension,
} from "./file-tree";

describe("buildFileTree", () => {
  it("nests directories and sorts folders before files", () => {
    expect(
      buildFileTree([
        { path: "README.md" },
        { path: "apps/web/app/api/route.ts" },
        { path: "apps/web/package.json", status: "M" },
        { path: "apps/web/app/page.tsx" },
      ]),
    ).toEqual([
      {
        kind: "dir",
        name: "apps",
        path: "apps",
        children: [
          {
            kind: "dir",
            name: "web",
            path: "apps/web",
            children: [
              {
                kind: "dir",
                name: "app",
                path: "apps/web/app",
                children: [
                  {
                    kind: "dir",
                    name: "api",
                    path: "apps/web/app/api",
                    children: [
                      {
                        kind: "file",
                        name: "route.ts",
                        path: "apps/web/app/api/route.ts",
                      },
                    ],
                  },
                  {
                    kind: "file",
                    name: "page.tsx",
                    path: "apps/web/app/page.tsx",
                  },
                ],
              },
              {
                kind: "file",
                name: "package.json",
                path: "apps/web/package.json",
                status: "M",
              },
            ],
          },
        ],
      },
      { kind: "file", name: "README.md", path: "README.md" },
    ]);
  });

  it("collects directory paths and resolves extensions", () => {
    const tree = buildFileTree([
      { path: "src/lib/util.ts" },
      { path: "src/index.ts" },
    ]);
    expect(collectDirectoryPaths(tree)).toEqual(["src", "src/lib"]);
    expect(fileExtension("apps/web/route.ts")).toBe("ts");
    expect(fileExtension(".gitignore")).toBe(".gitignore");
  });
});
