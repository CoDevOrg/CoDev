import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  member: vi.fn(),
  terminal: vi.fn(),
  upgrade: vi.fn(),
}));
vi.mock("./api", () => ({
  getApiUser: mocks.user,
  getApiUserAnyAuth: mocks.user,
  apiError: (error: Error, status = 400) =>
    Response.json({ error: error.message }, { status }),
}));
vi.mock("../gen2/workspaces", () => ({ requireGen2Member: mocks.member }));
vi.mock("../gen2/terminals", () => ({
  authorizeGen2TerminalStream: mocks.terminal,
}));
vi.mock("../gen2/terminal-stream", () => ({
  gen2TerminalStreamMaxPayload: 1024,
  gen2TerminalStreamQuerySchema: {
    safeParse: () => ({
      success: true,
      data: { sessionId: "s", worktreeId: "main", after: 0 },
    }),
  },
  handleGen2TerminalSocket: vi.fn(),
}));
vi.mock("../gen2/collaboration-socket", () => ({
  handleGen2CollaborationSocket: vi.fn(),
  gen2CollaborationSocketMaxPayload: 1024,
}));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            { id: "u", login: "ada", name: "Ada", avatarUrl: null },
          ],
        }),
      }),
    }),
  }),
}));
vi.mock("../platform/websocket", () => ({ upgradeWebSocket: mocks.upgrade }));
import { GET as collaboration } from "@/app/api/gen2/workspaces/[workspaceId]/collaboration/route";
import { GET as terminal } from "@/app/api/gen2/workspaces/[workspaceId]/terminal/stream/route";
const context = { params: Promise.resolve({ workspaceId: "w" }) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "u" });
  mocks.member.mockResolvedValue({ role: "editor" });
  mocks.upgrade.mockResolvedValue(new Response(null, { status: 204 }));
});
it.each([
  undefined,
  "https://guest.trycodev.com",
  "https://evil.example",
  "http://www.trycodev.com",
  "null",
])("rejects origin %s before workspace access or upgrade", async (origin) => {
  for (const handler of [collaboration, terminal]) {
    const response = await handler(
      new Request("https://www.trycodev.com/api/socket", {
        headers: origin ? { origin } : {},
      }),
      context,
    );
    expect(response.status).toBe(403);
  }
  expect(mocks.member).not.toHaveBeenCalled();
  expect(mocks.terminal).not.toHaveBeenCalled();
  expect(mocks.upgrade).not.toHaveBeenCalled();
});
it("allows same-origin member connections through both routes", async () => {
  for (const handler of [collaboration, terminal])
    expect(
      (
        await handler(
          new Request("https://www.trycodev.com/api/socket", {
            headers: { origin: "https://www.trycodev.com" },
          }),
          context,
        )
      ).status,
    ).toBe(204);
  expect(mocks.upgrade).toHaveBeenCalledTimes(2);
  expect(mocks.member).toHaveBeenCalledWith("w", "u");
  expect(mocks.terminal).toHaveBeenCalledWith("w", "u");
});
it("still requires authentication before upgrading", async () => {
  mocks.user.mockResolvedValue(null);
  expect(
    (
      await collaboration(
        new Request("https://www.trycodev.com/api/socket", {
          headers: { origin: "https://www.trycodev.com" },
        }),
        context,
      )
    ).status,
  ).toBe(401);
  expect(mocks.upgrade).not.toHaveBeenCalled();
});
