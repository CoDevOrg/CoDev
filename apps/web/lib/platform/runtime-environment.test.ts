import { afterEach, expect, it, vi } from "vitest";
const bindings = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("cloudflare:workers", () => ({ env: bindings }));
import { runtimeEnvironment } from "./runtime-environment";
afterEach(() => {
  delete bindings.CRON_SECRET;
  vi.unstubAllEnvs();
});
it("reads updated Worker bindings ahead of Node environment values", () => {
  vi.stubEnv("CRON_SECRET", "previous");
  bindings.CRON_SECRET = "current";
  expect(runtimeEnvironment().CRON_SECRET).toBe("current");
  bindings.CRON_SECRET = "rotated";
  expect(runtimeEnvironment().CRON_SECRET).toBe("rotated");
});
it("uses the Node environment on Vercel", () => {
  vi.stubEnv("CRON_SECRET", "vercel");
  expect(runtimeEnvironment().CRON_SECRET).toBe("vercel");
});
