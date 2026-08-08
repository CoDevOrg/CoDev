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
      "6da7b8e9cfe62e5b4d34bb52e8c570036c1935fc",
    );
  });

  it("adapts Orca's preload vocabulary to authenticated workspace APIs", () => {
    const adapter = source("apps/web/lib/orca-runtime-adapter.ts");
    const shell = source("apps/web/components/orca/orca-hosted-shell.tsx");

    expect(adapter).toContain("createOrcaRuntimeAdapter");
    expect(adapter).toContain("/sandbox");
    expect(shell).toContain("OrcaHostedSidebar");
    expect(shell).toContain("OrcaHostedInspector");
  });
});
