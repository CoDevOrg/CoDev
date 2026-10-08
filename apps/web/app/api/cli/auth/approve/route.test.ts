import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), approve: vi.fn() }));
vi.mock("@/lib/auth/identity", () => ({ getCurrentAppUser: mocks.user }));
vi.mock("@/lib/auth/cli-auth", () => ({
  approveCliDeviceAuthorization: mocks.approve,
  cliAuthErrorResponse: () =>
    Response.json({ error: "Invalid request." }, { status: 400 }),
}));
import { POST } from "./route";

function request(
  origin: string | null,
  contentType = "application/json",
  extra = {},
) {
  return new Request("https://trycodev.com/api/cli/auth/approve", {
    method: "POST",
    headers: {
      ...(origin === null ? {} : { origin }),
      "content-type": contentType,
      ...extra,
    },
    body: JSON.stringify({ userCode: "ABCD1234" }),
  });
}

describe("CLI device approval", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.user.mockResolvedValue({ id: "member-1" });
  });

  it.each([
    null,
    "null",
    "https://attacker.example",
    "https://runtime.trycodev.com",
    "http://trycodev.com",
  ])("rejects origin %s before approval", async (origin) => {
    expect((await POST(request(origin))).status).toBe(403);
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", ""])(
    "rejects content type %s",
    async (type) => {
      expect((await POST(request("https://trycodev.com", type))).status).toBe(
        415,
      );
      expect(mocks.approve).not.toHaveBeenCalled();
    },
  );

  it("approves authenticated same-origin JSON requests", async () => {
    expect(
      (
        await POST(
          request("https://trycodev.com", "application/json; charset=utf-8"),
        )
      ).status,
    ).toBe(200);
    expect(mocks.approve).toHaveBeenCalledWith({
      userCode: "ABCD1234",
      userId: "member-1",
    });
  });

  it("still requires authentication", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await POST(request("https://trycodev.com"))).status).toBe(401);
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("checks the authenticated Azure public origin", async () => {
    vi.stubEnv("AZURE_WEB_ORIGIN_SECRET", "test-edge-secret");
    try {
      const internal = new Request(
        "http://localhost:3000/api/cli/auth/approve",
        request("https://trycodev.com", "application/json", {
          "x-codev-public-host": "trycodev.com",
          "x-codev-origin-secret": "test-edge-secret",
        }),
      );
      expect((await POST(internal)).status).toBe(200);
      expect(mocks.approve).toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
