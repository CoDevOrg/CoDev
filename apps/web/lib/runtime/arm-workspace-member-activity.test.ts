import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  database: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
}));
vi.mock("../platform/database", () => ({ getDatabase: mocks.database }));
import { recordArmWorkspaceMemberActivity } from "./arm-workspace-member-activity";
beforeEach(() => vi.clearAllMocks());
it("connection checks, file reads, Git refreshes, overlap polls and terminal polls never count as input", async () => {
  for (const [method, path] of [
    ["GET", "/v1/runtime-activity"],
    ["POST", "/v1/files/read"],
    ["GET", "/v1/git/status"],
    ["POST", "/v1/superset/runtime/git"],
    ["POST", "/v1/superset/runtime/coordination/overlaps"],
    ["POST", "/v1/terminals/a/poll"],
    ["POST", "/v1/codex-execs/a/poll"],
    ["POST", "/v1/superset/file/changes"],
  ])
    await recordArmWorkspaceMemberActivity("workspace-a", 2, method!, path!);
  expect(mocks.database).not.toHaveBeenCalled();
});
it("records continuous typing once per interval for each generation", async () => {
  const where = vi.fn().mockResolvedValue(undefined);
  mocks.database.mockReturnValue({
    update: () => ({ set: () => ({ where }) }),
    select: () => ({ from: () => ({ where: () => ({}) }) }),
  });
  vi.useFakeTimers({ now: 1_000_000 });
  try {
    const input = "/v1/superset/runtime/terminal/input";
    await recordArmWorkspaceMemberActivity("workspace-b", 1, "POST", input);
    await recordArmWorkspaceMemberActivity("workspace-b", 1, "POST", input);
    expect(where).toHaveBeenCalledTimes(1);
    await recordArmWorkspaceMemberActivity("workspace-b", 2, "POST", input);
    expect(where).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(30_000);
    await recordArmWorkspaceMemberActivity("workspace-b", 1, "POST", input);
    expect(where).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});
