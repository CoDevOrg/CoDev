import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowStep } from "cloudflare:workers";
import type { schema } from "@codev/db";
import type { RepositorySnapshotFile } from "../github/github";
import type { getDatabase } from "../platform/database";
const request = vi.hoisted(() => vi.fn());
vi.mock("../github/github", () => ({ githubRequest: request }));
import { initializeArmPrivateSource } from "./arm-workspace-private-source";
import { ArmWorkflowIO } from "../runtime/arm-workflow-io";

const workspace = {
  ownerId: "owner",
  repository: "owner/private",
  baseSha: "a".repeat(40),
} as typeof schema.gen2Workspaces.$inferSelect;
const db = {} as ReturnType<typeof getDatabase>;
const step = {
  do: async (
    _name: string,
    _options: unknown,
    action: () => Promise<unknown>,
  ) => action(),
} as unknown as WorkflowStep;

describe("bounded private ARM initialization", () => {
  beforeEach(() => {
    request.mockReset();
  });

  it("transfers 60 files across continuations without repeating writes or carrying file contents", async () => {
    const files = Array.from({ length: 60 }, (_, index) => ({
      path: `file-${index}`,
      mode: "100644",
      type: "blob",
      sha: `${index}`,
      size: 6,
    }));
    request.mockImplementation(async (_owner, path: string) =>
      path.includes("/trees/")
        ? { truncated: false, tree: files }
        : { encoding: "base64", content: "c2VjcmV0" },
    );
    const write = vi.fn(async (file: RepositorySnapshotFile) => {
      expect(file.mode).toBe("100644");
    });
    let checkpoints: Record<string, unknown> = {};
    let finished = false;
    while (!finished) {
      await ArmWorkflowIO.run(step, "private", checkpoints, async () => {
        try {
          await initializeArmPrivateSource(workspace, db, write);
          finished = true;
        } catch (error) {
          expect(error).toMatchObject({ code: "WORKFLOW_CONTINUE" });
          checkpoints = JSON.parse(JSON.stringify(ArmWorkflowIO.saved()));
          expect(JSON.stringify(checkpoints)).not.toContain("c2VjcmV0");
        }
      });
    }
    expect(write).toHaveBeenCalledTimes(60);
    expect(request).toHaveBeenCalledTimes(61);
    expect(write.mock.calls.map((call) => call[0])).toEqual(
      files.map((file) => ({
        path: file.path,
        mode: "100644",
        contentBase64: "c2VjcmV0",
      })),
    );
  });

  it("rejects oversized trees before writing any files", async () => {
    request.mockResolvedValue({
      truncated: false,
      tree: [
        {
          path: "large",
          mode: "100644",
          type: "blob",
          sha: "blob",
          size: 4 * 1024 * 1024,
        },
      ],
    });
    const write = vi.fn();
    await expect(
      initializeArmPrivateSource(workspace, db, write),
    ).rejects.toThrow("3 MiB");
    expect(write).not.toHaveBeenCalled();
  });
});
