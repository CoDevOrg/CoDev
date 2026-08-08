import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "../..");

function source(path: string) {
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

describe("Orca workspace architecture", () => {
  it("renders the Orca browser workspace instead of an IDE iframe", () => {
    const page = source("apps/web/app/workspaces/[workspaceId]/ide/page.tsx");
    const workspace = source("apps/web/components/workspace-ide.tsx");

    expect(page).toContain("OrcaWorkspaceIdeLoader");
    expect(workspace).toContain('data-ide="orca"');
    expect(workspace).not.toContain("<iframe");
  });

  it("keeps the Firecracker guest focused on the workspace API", () => {
    const bootstrap = source("infra/aws/scripts/bootstrap-host.sh");
    const guest = source("services/orchestrator/src/guest.rs");

    expect(bootstrap).toContain("ExecStart=/usr/local/bin/codev-guestd");
    expect(bootstrap).not.toMatch(/theia/i);
    expect(guest).not.toMatch(/theia/i);
  });

  it("retains the pinned Orca license and upstream reference", () => {
    expect(
      existsSync(resolve(repositoryRoot, "third_party/orca/LICENSE")),
    ).toBe(true);
    expect(source("third_party/orca/UPSTREAM.md")).toContain(
      "fc8441194ce400ad3a6dfdc053d163a9f9688a33",
    );
  });
});
