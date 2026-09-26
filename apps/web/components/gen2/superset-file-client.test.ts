import { afterEach, describe, expect, it, vi } from "vitest";

import { readSupersetFile, saveSupersetFile } from "./superset-file-client";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const file = {
  path: "src/a file.ts",
  kind: "file" as const,
  size: 5,
  contents: "hello",
  revision: "rev-1",
};

afterEach(() => vi.unstubAllGlobals());

describe("Superset file client", () => {
  it("encodes a selected path and sends the loaded revision on save", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ file }))
      .mockResolvedValueOnce(
        Response.json({
          file: { ...file, contents: "edited", revision: "rev-2" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const loaded = await readSupersetFile(workspaceId, file.path);
    const readCall = fetchMock.mock.calls.at(0);
    expect(readCall?.[0]).toContain("path=src%2Fa+file.ts");
    const saved = await saveSupersetFile(workspaceId, loaded, "edited");
    expect(saved.revision).toBe("rev-2");
    const saveCall = fetchMock.mock.calls.at(1);
    expect(saveCall?.[1]).toMatchObject({ method: "PUT" });
    expect(JSON.parse(saveCall?.[1]?.body ?? "null")).toEqual({
      worktreeId: "main",
      path: file.path,
      contents: "edited",
      expectedRevision: "rev-1",
    });
  });

  it("preserves a revision conflict for the editor", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: "Changed on disk", currentRevision: "rev-2" },
            { status: 409 },
          ),
        ),
    );

    await expect(saveSupersetFile(workspaceId, file, "edited")).rejects.toEqual(
      expect.objectContaining({
        status: 409,
        currentRevision: "rev-2",
      }),
    );
  });
});
