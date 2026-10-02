import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attachDatabasePool: vi.fn(),
  createDatabase: vi.fn(() => ({
    db: { source: "shared" },
    pool: { on: vi.fn(), idleCount: 0 },
  })),
  readServerEnvironment: vi.fn(() => ({
    DATABASE_URL: "postgresql://example.test/codev",
  })),
  workersEnv: {} as { HYPERDRIVE?: { connectionString?: string } },
}));

vi.mock("@codev/config", () => ({
  readServerEnvironment: mocks.readServerEnvironment,
}));
vi.mock("@codev/db", () => ({ createDatabase: mocks.createDatabase }));
vi.mock("@vercel/functions", () => ({
  attachDatabasePool: mocks.attachDatabasePool,
}));
vi.mock("cloudflare:workers", () => ({
  env: mocks.workersEnv,
}));

describe("database client", () => {
  beforeEach(() => {
    delete (
      globalThis as typeof globalThis & { __codevDatabaseClient?: unknown }
    ).__codevDatabaseClient;
    mocks.attachDatabasePool.mockClear();
    mocks.createDatabase.mockClear();
    mocks.readServerEnvironment.mockClear();
    delete mocks.workersEnv.HYPERDRIVE;
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

  it("uses the Hyperdrive connection string on Workers", async () => {
    mocks.workersEnv.HYPERDRIVE = {
      connectionString: "postgres://hyperdrive.local/codev",
    };

    const database = await import("./database");
    database.getDatabase();

    expect(mocks.createDatabase).toHaveBeenCalledWith(
      "postgres://hyperdrive.local/codev?sslmode=disable",
      { maxUses: 1 },
    );
    expect(mocks.attachDatabasePool).not.toHaveBeenCalled();
  });
});
