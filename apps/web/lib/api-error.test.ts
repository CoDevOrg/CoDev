import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./database", () => ({ getDatabase: vi.fn() }));
vi.mock("./identity", () => ({ getCurrentAppUser: vi.fn() }));
vi.mock("./cli-auth", () => ({
  authenticateCliRequest: vi.fn(),
  CliAuthError: class CliAuthError extends Error {},
}));

import { apiError } from "./api";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The shape Drizzle throws: the statement and its parameters, in `message`. */
function drizzleQueryError() {
  const error = new Error(
    'Failed query: insert into "workspaces" ("id", "owner_id") values (default, $1) params: 464b50d7-70bb-4561-865b-f3cab780d5ef',
  );
  error.name = "DrizzleQueryError";
  return error;
}

describe("apiError", () => {
  it("passes through a message written for the reader", async () => {
    const response = apiError(new Error("Workspace not found."), 404);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Workspace not found.",
    });
  });

  it("never returns a failed query or its parameters", async () => {
    const response = apiError(drizzleQueryError());
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(body.error).not.toContain("insert into");
    expect(body.error).not.toContain("464b50d7");
    expect(body.error).toBe(
      "Something went wrong on our end. Please try again.",
    );
  });

  it("logs the driver error it withheld, so the cause stays diagnosable", () => {
    const error = drizzleQueryError();
    error.cause = new Error(
      'insert or update on table "workspaces" violates foreign key constraint',
    );

    apiError(error);

    expect(console.error).toHaveBeenCalledWith("[api] request failed", error);
  });

  it("recognises a node-postgres error by its protocol fields", async () => {
    const error = Object.assign(new Error("duplicate key value"), {
      severity: "ERROR",
      code: "23505",
    });

    const response = apiError(error, 400);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Something went wrong on our end. Please try again.",
    });
  });

  it("describes a non-Error rejection without inventing detail", async () => {
    const response = apiError("boom");
    await expect(response.json()).resolves.toEqual({
      error: "The request could not be completed.",
    });
  });
});
