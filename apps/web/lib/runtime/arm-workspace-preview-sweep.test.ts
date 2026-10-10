import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: vi.fn(), request: vi.fn() }));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({ from: () => ({ where: mocks.rows }) }),
  }),
}));
vi.mock("./arm-workspace-provider", () => ({
  CLOUDFLARE_ACCOUNT_ID: "account",
  cloudflareRequestDirect: mocks.request,
}));

import { sweepArmWorkspacePreviewRoutes } from "./arm-workspace-preview-sweep";

const zone = "codev-preview.dev";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 20);
const now = Date.parse("2026-10-09T12:00:00Z");
const record = (id: string, name: string, minutesAgo = 30) => ({
  id,
  name,
  content: "tunnel.cfargotunnel.com",
  created_on: new Date(now - minutesAgo * 60_000).toISOString(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CODEV_PREVIEW_ZONE", zone);
  vi.stubEnv("CODEV_PREVIEW_ZONE_ID", "0123456789abcdef0123456789abcdef");
  mocks.rows.mockResolvedValue([{ id: "live", generation: 4 }]);
});
afterEach(() => vi.unstubAllEnvs());

it("deletes only settled preview records of generations that are not ready", async () => {
  const records = [
    record("current", `p3000-${hash("live")}-g4.${zone}`),
    record("restarted", `p3000-${hash("live")}-g3.${zone}`),
    record("stopped", `p5173-${hash("gone")}-g9.${zone}`),
    record("fresh", `p8080-${hash("gone")}-g9.${zone}`, 1),
    record("unrelated", `www.${zone}`),
  ];
  mocks.request.mockImplementation(async (path: string, method = "GET") =>
    method === "GET" ? records : null,
  );
  expect(await sweepArmWorkspacePreviewRoutes(now)).toEqual({ deleted: 2 });
  const deletes = mocks.request.mock.calls
    .filter(([, method]) => method === "DELETE")
    .map(([path]) => String(path).split("/").at(-1));
  expect(deletes).toEqual(["restarted", "stopped"]);

  // Runs are time-gated per process.
  expect(await sweepArmWorkspacePreviewRoutes(now + 60_000)).toEqual({
    deleted: 0,
  });
  expect(mocks.request).toHaveBeenCalledTimes(3);

  // Cloudflare failures wait for the next run instead of failing the cron.
  mocks.request.mockRejectedValueOnce(new Error("CLOUDFLARE_TUNNEL_FAILED"));
  expect(await sweepArmWorkspacePreviewRoutes(now + 10 * 60_000)).toEqual({
    deleted: 0,
  });
});

it("does nothing without a preview zone", async () => {
  vi.stubEnv("CODEV_PREVIEW_ZONE", "");
  expect(await sweepArmWorkspacePreviewRoutes(now + 60 * 60_000)).toEqual({
    deleted: 0,
  });
  expect(mocks.request).not.toHaveBeenCalled();
});
