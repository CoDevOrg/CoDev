import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  remove: vi.fn(),
  mail: vi.fn(),
}));
vi.mock("@/lib/http/api", () => ({
  getApiUser: mocks.user,
  getApiUserAnyAuth: mocks.user,
  apiError: (error: Error, status = 400) =>
    Response.json({ error: error.message }, { status }),
}));
vi.mock("@/lib/auth/account-deletion", () => ({ deleteAccount: mocks.remove }));
vi.mock("@/lib/auth/account-deletion-mail", () => ({
  sendAccountDeletionVerification: mocks.mail,
}));
import { DELETE, POST } from "./route";
const call = (
  method: "POST" | "DELETE",
  origin = "https://codev.test",
  body: unknown = {
    confirmation: "DELETE",
    token: "verified",
    userId: "victim",
  },
) =>
  (method === "POST" ? POST : DELETE)(
    new Request("https://codev.test/api/settings/account", {
      method,
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  );

describe("account deletion boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.user.mockResolvedValue({ id: "caller" });
  });
  it("requires authentication", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await call("DELETE")).status).toBe(401);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each(["POST", "DELETE"] as const)(
    "rejects cross-origin %s",
    async (method) => {
      expect((await call(method, "https://evil.test")).status).toBe(403);
      expect(mocks.remove).not.toHaveBeenCalled();
      expect(mocks.mail).not.toHaveBeenCalled();
    },
  );
  it("requires explicit confirmation and verifies only the authenticated account", async () => {
    expect(
      (await call("DELETE", undefined, { confirmation: "no", token: "x" }))
        .status,
    ).toBe(400);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect((await call("DELETE")).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith("caller", "verified");
  });
  it("never reports success when cleanup fails", async () => {
    mocks.remove.mockRejectedValue(new Error("private stripe detail"));
    const response = await call("DELETE");
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private stripe detail");
  });
});
