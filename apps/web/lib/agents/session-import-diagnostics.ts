import "server-only";

import { logEvent, requestId } from "../platform/observability";
import { SessionImportStorageError } from "./session-import-storage";

function failureKind(error: unknown): string {
  const seen = new Set<unknown>();
  for (let current = error, depth = 0; depth < 4; depth++) {
    if (!(current instanceof Error) || seen.has(current)) break;
    seen.add(current);
    if (current instanceof SessionImportStorageError) return current.code;
    if (current.message === "CREDENTIAL_KEY_VAULT_KEY_ID is not configured.")
      return "key_vault_not_configured";
    if (current.message === "A PostgreSQL connection URL is not configured.")
      return "database_not_configured";

    const details = current as Error & {
      code?: unknown;
      statusCode?: unknown;
      cause?: unknown;
    };
    if (details.code === "42P01") return "database_migration_missing";
    if (details.code === "42501") return "database_permission_denied";
    if (current.name === "RestError" && details.statusCode === 403)
      return "key_vault_access_denied";
    current = details.cause;
  }
  return "unexpected_storage_error";
}

export function logSessionImportStorageFailure(
  request: Request,
  source: "provider_source" | "capsule",
  error: unknown,
) {
  // Rollouts and SDK errors can contain session text, credentials, account IDs,
  // and infrastructure paths. Log only a fixed diagnostic category.
  logEvent("error", "session_import_storage_failed", {
    requestId: requestId(request),
    source,
    failureKind: failureKind(error),
  });
}
