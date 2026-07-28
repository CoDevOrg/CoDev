import { describe, expect, it } from "vitest";

import { normalizePostgresConnectionString } from "./connection";

describe("PostgreSQL connection strings", () => {
  it("uses libpq semantics for Supabase sslmode=require URLs", () => {
    const connectionString = normalizePostgresConnectionString(
      "postgresql://postgres:secret@pooler.example.test:6543/postgres?sslmode=require",
    );
    const url = new URL(connectionString);

    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.get("uselibpqcompat")).toBe("true");
  });

  it("does not weaken verify-full URLs", () => {
    const connectionString = normalizePostgresConnectionString(
      "postgresql://postgres:secret@db.example.test:5432/postgres?sslmode=verify-full",
    );
    const url = new URL(connectionString);

    expect(url.searchParams.get("sslmode")).toBe("verify-full");
    expect(url.searchParams.has("uselibpqcompat")).toBe(false);
  });
});
