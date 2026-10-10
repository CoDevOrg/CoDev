import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  env: {} as { HYPERDRIVE?: { connectionString: string } },
  query: vi.fn(),
  end: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@codev/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@codev/db")>()),
  createDatabase: mocks.create,
}));
vi.mock("../platform/database", () => ({ getDatabase: mocks.get }));
import { readSessionRevision } from "./read-session-revision";
import { sessionRevision } from "./session-revision";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.HYPERDRIVE = {
    connectionString:
      "postgres://local:local@127.0.0.1:5432/local?sslmode=require",
  };
  const db = {
    select: () => ({
      from: () => ({
        leftJoin: () => ({ where: () => ({ limit: mocks.query }) }),
      }),
    }),
  };
  mocks.create.mockReturnValue({ db, pool: { end: mocks.end } });
  mocks.get.mockReturnValue(db);
  mocks.query.mockResolvedValue([
    { passwordHash: "hash", sessionId: "s", revokedAt: null, lastSeenAt: null },
  ]);
  mocks.end.mockResolvedValue(undefined);
});
afterEach(() => {
  delete mocks.env.HYPERDRIVE;
});
it("opens and closes a new socket-scoped Hyperdrive pool instead of reusing the HTTP pool", async () => {
  expect(await readSessionRevision("u", "s")).toBe(sessionRevision("hash"));
  expect(mocks.create).toHaveBeenCalledWith(
    "postgres://local:local@127.0.0.1:5432/local?sslmode=disable",
    { max: 1, maxUses: 1 },
  );
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.end).toHaveBeenCalledOnce();
});
it("closes its pool even if credential storage fails", async () => {
  mocks.query.mockRejectedValue(new Error("offline"));
  await expect(readSessionRevision("u")).rejects.toThrow("offline");
  expect(mocks.end).toHaveBeenCalledOnce();
});
it("uses the regular Node database on Vercel and detects deleted accounts", async () => {
  delete mocks.env.HYPERDRIVE;
  mocks.query.mockResolvedValue([]);
  expect(await readSessionRevision("u")).toBeNull();
  expect(mocks.get).toHaveBeenCalledOnce();
  expect(mocks.create).not.toHaveBeenCalled();
});
it("treats a revoked or missing session row as signed out", async () => {
  delete mocks.env.HYPERDRIVE;
  mocks.query.mockResolvedValue([
    {
      passwordHash: "hash",
      sessionId: "s",
      revokedAt: new Date(),
      lastSeenAt: null,
    },
  ]);
  expect(await readSessionRevision("u", "s")).toBeNull();
  mocks.query.mockResolvedValue([
    {
      passwordHash: "hash",
      sessionId: null,
      revokedAt: null,
      lastSeenAt: null,
    },
  ]);
  expect(await readSessionRevision("u", "s")).toBeNull();
  // A cookie from before session tracking stays valid until revoked.
  expect(await readSessionRevision("u")).toBe(sessionRevision("hash"));
});
