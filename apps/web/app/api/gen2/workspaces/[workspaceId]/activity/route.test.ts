import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  get: vi.fn(),
  touch: vi.fn(),
}));
vi.mock("@/lib/http/api-route", () => ({
  withUser:
    (
      handler: (input: {
        user: { id: string };
        params: { workspaceId: string };
      }) => Promise<Response>,
    ) =>
    () =>
      handler({ user: { id: "u" }, params: { workspaceId: "w" } }),
}));
vi.mock("@/lib/gen2/workspaces", () => ({ requireGen2Member: mocks.member }));
vi.mock("@/lib/runtime/orchestrator-sandbox", () => ({
  getSandbox: mocks.get,
  touchSandbox: mocks.touch,
}));
import { OrchestratorError } from "@/lib/runtime/orchestrator-request";
import { GET, POST } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.member.mockResolvedValue({});
  mocks.get.mockResolvedValue({ status: "ready" });
  mocks.touch.mockResolvedValue({ status: "ready" });
});
it("status checks authorize the member but do not count as activity", async () => {
  expect(
    await (
      await GET(new Request("http://localhost/test"), {
        params: Promise.resolve({ workspaceId: "w" }),
      })
    ).json(),
  ).toEqual({ connected: true });
  expect(mocks.member).toHaveBeenCalledWith("w", "u");
  expect(mocks.touch).not.toHaveBeenCalled();
});
it("explicit activity touches the existing guest", async () => {
  expect(
    await (
      await POST(new Request("http://localhost/test", { method: "POST" }), {
        params: Promise.resolve({ workspaceId: "w" }),
      })
    ).json(),
  ).toEqual({ connected: true });
  expect(mocks.touch).toHaveBeenCalledWith("w", 8_000);
});
it("a hibernated guest is reported as disconnected without recreation", async () => {
  mocks.get.mockRejectedValue(new OrchestratorError("not found", 404));
  expect(
    await (
      await GET(new Request("http://localhost/test"), {
        params: Promise.resolve({ workspaceId: "w" }),
      })
    ).json(),
  ).toEqual({ connected: false });
  expect(mocks.touch).not.toHaveBeenCalled();
});
it("unauthorized callers cannot reach the runtime", async () => {
  mocks.member.mockRejectedValue(new Error("not a member"));
  await expect(
    GET(new Request("http://localhost/test"), {
      params: Promise.resolve({ workspaceId: "w" }),
    }),
  ).rejects.toThrow("not a member");
  expect(mocks.get).not.toHaveBeenCalled();
});
