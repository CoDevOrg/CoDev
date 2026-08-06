import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  countResult,
  insertReturning,
  updateReturning,
  deleteReturning,
  encryptSecret,
  decryptSecret,
} = vi.hoisted(() => ({
  countResult: vi.fn(),
  insertReturning: vi.fn(),
  updateReturning: vi.fn(),
  deleteReturning: vi.fn(),
  encryptSecret: vi.fn(async (value: string) => `enc:${value}`),
  decryptSecret: vi.fn(async (value: string) => value.replace(/^enc:/, "")),
}));

vi.mock("./database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => {
          const rows = countResult();
          return {
            orderBy: async () => rows,
            then: (
              onFulfilled: (value: unknown) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) => Promise.resolve(rows).then(onFulfilled, onRejected),
          };
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: async () => insertReturning(),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => updateReturning(),
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: async () => deleteReturning(),
      }),
    }),
  }),
}));

vi.mock("./kms", () => ({
  encryptSecret,
  decryptSecret,
}));

import {
  createUserEnvironmentVariable,
  deleteUserEnvironmentVariable,
  updateUserEnvironmentVariable,
} from "./user-environment";

beforeEach(() => {
  countResult.mockReset();
  insertReturning.mockReset();
  updateReturning.mockReset();
  deleteReturning.mockReset();
  encryptSecret.mockClear();
  decryptSecret.mockClear();
});

describe("user environment variables", () => {
  it("creates an encrypted variable and returns only the public shape", async () => {
    countResult.mockReturnValueOnce([{ count: 0 }]);
    const now = new Date("2026-08-05T12:00:00.000Z");
    insertReturning.mockResolvedValueOnce([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "OPENAI_API_KEY",
        lastFour: "abcd",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const variable = await createUserEnvironmentVariable("user-1", {
      name: "OPENAI_API_KEY",
      value: "sk-test-abcd",
    });

    expect(encryptSecret).toHaveBeenCalledWith(
      "sk-test-abcd",
      expect.objectContaining({ purpose: "user-environment-variable" }),
    );
    expect(variable).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      name: "OPENAI_API_KEY",
      lastFour: "abcd",
      createdAt: "2026-08-05T12:00:00.000Z",
      updatedAt: "2026-08-05T12:00:00.000Z",
    });
    expect(variable).not.toHaveProperty("value");
    expect(variable).not.toHaveProperty("encryptedValue");
  });

  it("rejects invalid names before writing", async () => {
    await expect(
      createUserEnvironmentVariable("user-1", {
        name: "bad-name",
        value: "secret",
      }),
    ).rejects.toThrow();
    expect(insertReturning).not.toHaveBeenCalled();
  });

  it("updates and deletes by ownership", async () => {
    const now = new Date("2026-08-05T12:00:00.000Z");
    updateReturning.mockResolvedValueOnce([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "OPENAI_API_KEY",
        lastFour: "zzzz",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    deleteReturning.mockResolvedValueOnce([
      { id: "11111111-1111-4111-8111-111111111111" },
    ]);

    await expect(
      updateUserEnvironmentVariable(
        "user-1",
        "11111111-1111-4111-8111-111111111111",
        { value: "sk-new-zzzz" },
      ),
    ).resolves.toMatchObject({ lastFour: "zzzz" });

    await expect(
      deleteUserEnvironmentVariable(
        "user-1",
        "11111111-1111-4111-8111-111111111111",
      ),
    ).resolves.toBeUndefined();
  });
});
