import { afterEach, describe, expect, it, vi } from "vitest";

import { createOrcaRuntimeAdapter } from "./orca-runtime-adapter";

afterEach(() => vi.unstubAllGlobals());

describe("Orca runtime adapter", () => {
  it("maps Orca file operations onto the authenticated sandbox API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          files: [{ path: "src/app.ts", status: "M" }, { path: "README.md" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const runtime = createOrcaRuntimeAdapter("workspace-1");
    await expect(runtime.files.list()).resolves.toEqual([
      { path: "src/app.ts", status: "M" },
      { path: "README.md" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/sandbox/files",
      { cache: "no-store" },
    );
  });

  it("validates data returned across the guest boundary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ files: [{ path: 42 }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const runtime = createOrcaRuntimeAdapter("workspace-1");
    await expect(runtime.files.list()).rejects.toThrow();
  });

  it("surfaces sandbox errors with their original message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Workspace is restoring." }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const runtime = createOrcaRuntimeAdapter("workspace-1");
    await expect(runtime.git.branches()).rejects.toThrow(
      "Workspace is restoring.",
    );
  });
});
