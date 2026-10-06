import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  env: {
    HYPERDRIVE: { connectionString: "postgres://hyperdrive.local/codev" },
  },
  createDatabase: vi.fn(() => ({
    db: {},
    pool: { end: vi.fn(async () => undefined) },
  })),
}));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@codev/db", () => ({ createDatabase: mocks.createDatabase }));
vi.mock("next/server", () => ({ after: mocks.after }));
import { withDatabaseOperation } from "./database-operation";
import { getDatabase } from "./database";

beforeEach(() => {
  mocks.createDatabase.mockClear();
  mocks.after.mockClear();
});

it("isolates overlapping socket messages and closes each pool after its own work", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first: ReturnType<typeof getDatabase>;
  const firstMessage = withDatabaseOperation(async () => {
    first = getDatabase();
    await pending;
    expect(getDatabase()).toBe(first);
  });
  const firstPool = mocks.createDatabase.mock.results[0]!.value.pool;
  await withDatabaseOperation(async () => {
    expect(getDatabase()).not.toBe(first);
    expect(firstPool.end).not.toHaveBeenCalled();
  });
  release();
  await firstMessage;
  expect(mocks.after).not.toHaveBeenCalled();
  expect(mocks.createDatabase).toHaveBeenCalledTimes(2);
  for (const result of mocks.createDatabase.mock.results) {
    expect(result.value.pool.end).toHaveBeenCalledOnce();
  }
});

it("closes a socket message pool when its operation fails", async () => {
  await expect(
    withDatabaseOperation(async () => {
      throw new Error("failed");
    }),
  ).rejects.toThrow("failed");
  expect(
    mocks.createDatabase.mock.results[0]!.value.pool.end,
  ).toHaveBeenCalledOnce();
});
