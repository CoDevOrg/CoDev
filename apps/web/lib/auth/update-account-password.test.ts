import { beforeEach, expect, it, vi } from "vitest";
import { schema } from "@codev/db";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  remove: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
  hash: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("../platform/crypto", () => ({ hashPassword: mocks.hash }));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({ transaction: mocks.transaction }),
}));
import { updateAccountPassword } from "./update-account-password";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.hash.mockResolvedValue("new-hash");
  mocks.returning.mockResolvedValue([{ id: "u" }]);
  mocks.where.mockReturnValue({ returning: mocks.returning });
  mocks.update.mockReturnValue({ set: vi.fn(() => ({ where: mocks.where })) });
  mocks.remove.mockReturnValue({ where: vi.fn() });
  mocks.transaction.mockImplementation((fn) =>
    fn({ update: mocks.update, delete: mocks.remove }),
  );
});
it("conditionally replaces the password and retires tokens and device approvals in the same transaction", async () => {
  expect(await updateAccountPassword("u", "old-hash", "password")).toBe(true);
  expect(mocks.transaction).toHaveBeenCalledOnce();
  expect(
    new PgDialect().sqlToQuery(mocks.where.mock.calls[0]![0]).params,
  ).toEqual(["u", "old-hash"]);
  expect(mocks.update.mock.calls.map(([table]) => table)).toEqual([
    schema.users,
    schema.cliAccessTokens,
  ]);
  expect(mocks.remove).toHaveBeenCalledWith(schema.cliDeviceAuthorizations);
});
it("rejects a replayed reset without revoking tokens from the newer login", async () => {
  mocks.returning.mockResolvedValue([]);
  expect(await updateAccountPassword("u", "stale-hash", "password")).toBe(
    false,
  );
  expect(mocks.update).toHaveBeenCalledTimes(1);
  expect(mocks.remove).not.toHaveBeenCalled();
});
it("only adds a password to an OAuth account whose password is still empty", async () => {
  expect(await updateAccountPassword("u", null, "password")).toBe(true);
  const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0]![0]);
  expect(query.sql).toContain("is null");
  expect(query.params).toEqual(["u"]);
});
it("propagates revocation failures so the database transaction rolls back", async () => {
  mocks.update
    .mockImplementationOnce(() => ({ set: () => ({ where: mocks.where }) }))
    .mockImplementationOnce(() => {
      throw new Error("revocation failed");
    });
  await expect(
    updateAccountPassword("u", "old-hash", "password"),
  ).rejects.toThrow("revocation failed");
});
