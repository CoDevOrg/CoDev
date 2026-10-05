import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  database: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
}));
vi.mock("../platform/database", () => ({ getDatabase: mocks.database }));
import { recordArmWorkspaceMemberActivity } from "./arm-workspace-member-activity";
beforeEach(() => vi.clearAllMocks());
it("connection checks, file reads, Git refreshes and terminal polls never count as input", async () => {
  for (const [method, path] of [
    ["GET", "/v1/runtime-activity"],
    ["POST", "/v1/files/read"],
    ["GET", "/v1/git/status"],
    ["POST", "/v1/superset/runtime/git"],
    ["POST", "/v1/terminals/a/poll"],
    ["POST", "/v1/codex-execs/a/poll"],
    ["POST", "/v1/superset/file/changes"],
  ])
    await recordArmWorkspaceMemberActivity("workspace-a", 2, method!, path!);
  expect(mocks.database).not.toHaveBeenCalled();
});
