import { describe, expect, it } from "vitest";

import { readServerEnvironment } from "./index";

describe("server environment", () => {
  it("allows an empty Phase 1 environment", () => {
    expect(
      readServerEnvironment({ NODE_ENV: "test", DATABASE_URL: "" }),
    ).toEqual({
      NODE_ENV: "test",
      DATABASE_URL: undefined,
    });
  });

  it("rejects malformed service URLs", () => {
    expect(() =>
      readServerEnvironment({
        NODE_ENV: "production",
        ORCHESTRATOR_URL: "not a URL",
      }),
    ).toThrow();
  });

  it("accepts Vercel Marketplace Supabase variables", () => {
    expect(
      readServerEnvironment({
        NODE_ENV: "production",
        POSTGRES_URL: "postgresql://postgres.example.test/codev",
        POSTGRES_URL_NON_POOLING:
          "postgresql://postgres.example.test:5432/codev",
        SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      }),
    ).toMatchObject({
      POSTGRES_URL: "postgresql://postgres.example.test/codev",
      SUPABASE_URL: "https://example.supabase.co",
    });
  });
});
