import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requirePermission: vi.fn() }));

vi.mock("./workspace", () => ({
  requireWorkspacePermission: (...args: unknown[]) =>
    mocks.requirePermission(...args),
}));

import { requireContextInTurn, requireContextView } from "./context";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const access = { role: "editor", capabilities: {} };

describe("context policy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requirePermission.mockResolvedValue(access);
  });

  it("separates viewing shared context from including it in a turn", async () => {
    await expect(requireContextView(workspaceId, userId)).resolves.toBe(access);
    await expect(requireContextInTurn(workspaceId, userId)).resolves.toBe(
      access,
    );

    expect(mocks.requirePermission).toHaveBeenNthCalledWith(
      1,
      workspaceId,
      userId,
      "context.view",
    );
    expect(mocks.requirePermission).toHaveBeenNthCalledWith(
      2,
      workspaceId,
      userId,
      "context.includeInTurn",
    );
  });
});
