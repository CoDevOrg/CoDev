import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./session-import-storage", () => ({
  SessionImportStorageError: class extends Error {
    constructor(
      message: string,
      readonly status = 400,
      readonly code = "session_import_storage_error",
    ) {
      super(message);
    }
  },
}));

import { logSessionImportStorageFailure } from "./session-import-diagnostics";

afterEach(() => vi.restoreAllMocks());

describe("session import failure diagnostics", () => {
  it.each([
    [
      new Error("CREDENTIAL_KEY_VAULT_KEY_ID is not configured."),
      "key_vault_not_configured",
    ],
    [
      Object.assign(new Error("relation agent_session_imports missing"), {
        code: "42P01",
      }),
      "database_migration_missing",
    ],
    [
      Object.assign(new Error("query failed"), {
        cause: Object.assign(new Error("private SQL details"), {
          code: "42P01",
        }),
      }),
      "database_migration_missing",
    ],
    [
      new Error("A PostgreSQL connection URL is not configured."),
      "database_not_configured",
    ],
    [
      Object.assign(new Error("private vault path and caller IDs"), {
        name: "RestError",
        statusCode: "403",
      }),
      "key_vault_access_denied",
    ],
    [
      Object.assign(new Error("private Azure SDK details"), {
        name: "RestError",
      }),
      "key_vault_error",
    ],
    [new Error("private session transcript"), "unexpected_storage_error"],
  ])("logs a safe category for a storage failure", (error, expectedKind) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    logSessionImportStorageFailure(
      new Request("https://codev.test", {
        headers: { "x-vercel-id": "request-123" },
      }),
      "provider_source",
      error,
    );

    const record = JSON.parse(String(logged.mock.calls[0]?.[0]));
    expect(record).toMatchObject({
      event: "session_import_storage_failed",
      requestId: "request-123",
      source: "provider_source",
      failureKind: expectedKind,
    });
    expect(JSON.stringify(record)).not.toContain(error.message);
  });
});
