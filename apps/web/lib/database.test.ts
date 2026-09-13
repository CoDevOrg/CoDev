import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attachDatabasePool: vi.fn(),
  createDatabase: vi.fn(() => ({ db: { source: "shared" }, pool: {} })),
  readServerEnvironment: vi.fn(() => ({
    DATABASE_URL: "postgresql://example.test/codev",
  })),
}));

vi.mock("@codev/config", () => ({
  readServerEnvironment: mocks.readServerEnvironment,
}));
vi.mock("@codev/db", () => ({ createDatabase: mocks.createDatabase }));
vi.mock("@vercel/functions", () => ({
  attachDatabasePool: mocks.attachDatabasePool,
}));

describe("database client", () => {
  beforeEach(() => {
    delete (
      globalThis as typeof globalThis & { __codevDatabaseClient?: unknown }
    ).__codevDatabaseClient;
    mocks.attachDatabasePool.mockClear();
    mocks.createDatabase.mockClear();
    mocks.readServerEnvironment.mockClear();
    vi.resetModules();
  });

  it("shares one pool across Next.js module graphs", async () => {
    const firstModule = await import("./database");
    const first = firstModule.getDatabase();

    vi.resetModules();
    const secondModule = await import("./database");
    const second = secondModule.getDatabase();

    expect(second).toBe(first);
    expect(mocks.createDatabase).toHaveBeenCalledTimes(1);
    expect(mocks.attachDatabasePool).toHaveBeenCalledTimes(1);
  });
});
