import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ row: vi.fn(), set: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@upstash/redis", () => ({
  Redis: class {
    set = mocks.set;
  },
}));
vi.mock("../platform/rate-limit", () => ({ consumeRateLimit: vi.fn() }));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [mocks.row()] }) }),
    }),
  }),
}));

import {
  createAdminHandoffUrl,
  redeemAdminHandoffTicket,
} from "./admin-handoff";

const admin = {
  id: "user-1",
  name: "Ada",
  email: "ada@example.com",
  avatarUrl: null,
  isAdmin: true,
  passwordHash: null,
};

async function ticket() {
  const url = await createAdminHandoffUrl("user-1");
  expect(url?.origin).toBe("https://admins.trycodev.com");
  expect(url?.pathname).toBe("/api/auth/admin-handoff");
  return url!.searchParams.get("ticket")!;
}

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "s".repeat(40));
  vi.stubEnv("KV_REST_API_URL", "https://redis.example");
  vi.stubEnv("KV_REST_API_TOKEN", "token");
  mocks.row.mockReturnValue(admin);
  mocks.set.mockResolvedValue("OK");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it("redeems a fresh ticket for the same administrator", async () => {
  await expect(redeemAdminHandoffTicket(await ticket())).resolves.toMatchObject(
    {
      id: "user-1",
      email: "ada@example.com",
    },
  );
});

it("refuses to mint tickets for non-administrators", async () => {
  mocks.row.mockReturnValue({ ...admin, isAdmin: false });
  await expect(createAdminHandoffUrl("user-1")).resolves.toBeNull();
});

it("rejects tampered, replayed, and expired tickets", async () => {
  const value = await ticket();
  await expect(redeemAdminHandoffTicket(`${value}x`)).resolves.toBeNull();
  mocks.set.mockResolvedValue(null);
  await expect(redeemAdminHandoffTicket(value)).resolves.toBeNull();
  mocks.set.mockResolvedValue("OK");
  vi.useFakeTimers({ now: Date.now() + 61_000 });
  await expect(redeemAdminHandoffTicket(value)).resolves.toBeNull();
});

it("rejects tickets after admin removal or a password change", async () => {
  const [first, second] = [await ticket(), await ticket()];
  mocks.row.mockReturnValue({ ...admin, passwordHash: "changed" });
  await expect(redeemAdminHandoffTicket(first)).resolves.toBeNull();
  mocks.row.mockReturnValue({ ...admin, isAdmin: false });
  await expect(redeemAdminHandoffTicket(second)).resolves.toBeNull();
});
