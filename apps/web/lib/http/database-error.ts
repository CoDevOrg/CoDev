/** Recognize database failures without returning queries, parameters or credentials. */
export function databaseFailure(
  error: unknown,
): { code: string; schema: boolean } | null {
  const seen = new Set<unknown>();
  let current = error;
  let queryFailure = false;
  for (
    let depth = 0;
    depth < 8 && current && typeof current === "object" && !seen.has(current);
    depth++
  ) {
    seen.add(current);
    const value = current as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      cause?: unknown;
    };
    queryFailure ||=
      value.name === "DrizzleQueryError" ||
      (typeof value.message === "string" &&
        value.message.startsWith("Failed query:"));
    if (typeof value.code === "string" && /^[0-9A-Z]{5}$/.test(value.code)) {
      return {
        code: value.code,
        schema: ["42P01", "42703", "42704"].includes(value.code),
      };
    }
    current = value.cause;
  }
  return queryFailure ? { code: "query_failed", schema: false } : null;
}

export function databaseErrorResponse(error: unknown): Response | null {
  const failure = databaseFailure(error);
  if (!failure) return null;
  // Log classification only: the query can contain private user data.
  console.error(
    JSON.stringify({
      event: "database_request_failed",
      code: failure.code,
      schema: failure.schema,
    }),
  );
  return Response.json(
    {
      error: failure.schema
        ? "Chat storage is being updated. Please try again shortly. If this continues, contact support."
        : "CoDev couldn't reach its storage. Please try again shortly.",
      code: failure.schema
        ? "storage_schema_unavailable"
        : "storage_unavailable",
    },
    { status: 503, headers: { "Retry-After": "5" } },
  );
}
