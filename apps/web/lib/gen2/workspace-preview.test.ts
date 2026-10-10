import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  allow: vi.fn(),
  target: vi.fn(),
  ensure: vi.fn(),
  token: vi.fn(),
}));
vi.mock("./preview-access", () => ({ gen2PreviewAccess: mocks.access }));
vi.mock("./preview-rate-limit", () => ({
  allowGen2PreviewSession: mocks.allow,
}));
vi.mock("../runtime/workspace-runtime-target", () => ({
  runtimeTargetFromRow: mocks.target,
}));
vi.mock("../runtime/arm-workspace-preview-route", () => ({
  ensureArmWorkspacePreviewRoute: mocks.ensure,
  armWorkspacePreviewToken: mocks.token,
}));

import { Gen2AccessError } from "./errors";
import { ArmWorkspaceRuntimeError } from "../runtime/arm-workspace-error";
import { createGen2PreviewSession } from "./workspace-preview";

const zoneId = "0123456789abcdef0123456789abcdef";
const access = {
  provider: "azure_arm",
  status: "ready",
  generation: 5,
  host: "codev-x-g5.trycodev.com",
  tunnelId: "tunnel-1",
};
const input = (origin: string | null = "https://www.trycodev.com") => ({
  workspaceId: "w",
  userId: "u",
  origin,
  request: { port: 5173, path: "/app?tab=1#top" },
});

describe("creating a preview session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODEV_PREVIEW_ZONE", "codev-preview.dev");
    vi.stubEnv("CODEV_PREVIEW_ZONE_ID", zoneId);
    mocks.access.mockResolvedValue(access);
    mocks.allow.mockResolvedValue(true);
    mocks.target.mockResolvedValue({
      workspaceId: "w",
      generation: 5,
      host: access.host,
    });
    mocks.ensure.mockResolvedValue("p5173-abc-g5.codev-preview.dev");
    mocks.token.mockResolvedValue("header.claims.signature");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("routes the host and returns a session URL with an encoded next path", async () => {
    const session = await createGen2PreviewSession(input());
    const url = new URL(session.url);
    expect(url.origin).toBe("https://p5173-abc-g5.codev-preview.dev");
    expect(url.pathname).toBe("/__codev/preview/session");
    expect(url.searchParams.get("token")).toBe("header.claims.signature");
    expect(url.searchParams.get("next")).toBe("/app?tab=1#top");
    expect(url.hash).toBe("");
    expect(Date.parse(session.expiresAt)).toBeGreaterThan(Date.now());
    expect(mocks.ensure).toHaveBeenCalledWith({
      workspaceId: "w",
      generation: 5,
      tunnelId: "tunnel-1",
      port: 5173,
      zone: "codev-preview.dev",
      zoneId,
    });
    expect(mocks.token).toHaveBeenCalledWith({
      host: "p5173-abc-g5.codev-preview.dev",
      workspaceId: "w",
      generation: 5,
      port: 5173,
      userId: "u",
      appOrigin: "https://www.trycodev.com",
    });
    expect(mocks.allow).toHaveBeenCalledWith("u", "w");
  });

  it("rejects viewers before spending the rate limit or touching Cloudflare", async () => {
    mocks.access.mockRejectedValueOnce(
      new Gen2AccessError("Only editors can open previews.", 403),
    );
    await expect(createGen2PreviewSession(input())).rejects.toMatchObject({
      status: 403,
    });
    expect(mocks.allow).not.toHaveBeenCalled();
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it("is unavailable without a preview zone, and limited per member", async () => {
    vi.stubEnv("CODEV_PREVIEW_ZONE", "preview.trycodev.com");
    await expect(createGen2PreviewSession(input())).rejects.toMatchObject({
      status: 501,
    });
    vi.stubEnv("CODEV_PREVIEW_ZONE", "codev-preview.dev");
    mocks.allow.mockResolvedValueOnce(false);
    await expect(createGen2PreviewSession(input())).rejects.toMatchObject({
      status: 429,
    });
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it.each([null, "https://admins.trycodev.com", "http://localhost:3000"])(
    "frames previews only from an app origin (%s)",
    async (origin) => {
      await expect(
        createGen2PreviewSession(input(origin)),
      ).rejects.toMatchObject({ status: 403 });
      expect(mocks.token).not.toHaveBeenCalled();
    },
  );

  it("needs a guest with a tunnel, and hides Cloudflare failures", async () => {
    mocks.access.mockResolvedValueOnce({ ...access, tunnelId: null });
    await expect(createGen2PreviewSession(input())).rejects.toMatchObject({
      status: 409,
    });
    mocks.ensure.mockRejectedValueOnce(
      new ArmWorkspaceRuntimeError("CLOUDFLARE_TUNNEL_FAILED"),
    );
    await expect(createGen2PreviewSession(input())).rejects.toMatchObject({
      status: 502,
      message: "Couldn’t prepare the preview. Try again.",
    });
  });

  it("frames the developer's own server in local direct mode", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CODEV_PREVIEW_ZONE", "");
    vi.stubEnv("CODEV_PREVIEW_DEV_DIRECT", "1");
    const session = await createGen2PreviewSession(input(null));
    expect(session.url).toBe("http://localhost:5173/app?tab=1#top");
    expect(mocks.ensure).not.toHaveBeenCalled();
  });
});
