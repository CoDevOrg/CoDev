import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attachDatabasePool: vi.fn(),
  createDatabase: vi.fn(),
  readServerEnvironment: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@codev/config", () => ({
  readServerEnvironment: mocks.readServerEnvironment,
}));
vi.mock("@codev/db", () => ({
  createDatabase: mocks.createDatabase,
}));
vi.mock("@vercel/functions", () => ({
  attachDatabasePool: mocks.attachDatabasePool,
}));

describe("database connection health", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.readServerEnvironment.mockReturnValue({
      DATABASE_URL: "postgresql://codev:codev@example.test/codev",
      POSTGRES_URL: undefined,
    });
  });

  it("checks the workspace schema, not just bare connectivity", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const db = { select: vi.fn() };
    mocks.createDatabase.mockReturnValue({ db, pool });

    const { checkDatabaseConnection } = await import("./database");

    await checkDatabaseConnection();

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('from "workspaces"'),
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('"owner_id"'),
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("'stopping'"),
    );
  });

  it("attaches the pool once for the cached database client", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const db = { select: vi.fn() };
    mocks.createDatabase.mockReturnValue({ db, pool });

    const { checkDatabaseConnection, getDatabase } = await import("./database");

    expect(getDatabase()).toBe(db);
    await checkDatabaseConnection();

    expect(mocks.createDatabase).toHaveBeenCalledTimes(1);
    expect(mocks.attachDatabasePool).toHaveBeenCalledTimes(1);
  });
});
