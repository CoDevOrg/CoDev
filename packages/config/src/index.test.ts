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

  it("accepts a Vercel OIDC role and orchestrator endpoint", () => {
    expect(
      readServerEnvironment({
        AWS_REGION: "us-east-2",
        AWS_ROLE_ARN: "arn:aws:iam::014576992564:role/codev-vercel-production",
        AWS_HOST_INSTANCE_ID: "i-013491494b11b2ec5",
        ORCHESTRATOR_URL: "https://example.execute-api.us-east-2.amazonaws.com",
      }),
    ).toMatchObject({
      AWS_REGION: "us-east-2",
      AWS_ROLE_ARN: "arn:aws:iam::014576992564:role/codev-vercel-production",
      AWS_HOST_INSTANCE_ID: "i-013491494b11b2ec5",
    });
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

  it("accepts a comma-separated pilot administrator allowlist", () => {
    expect(
      readServerEnvironment({
        PILOT_ADMIN_GITHUB_LOGINS: "yousef20920,codev-operator",
      }),
    ).toMatchObject({
      PILOT_ADMIN_GITHUB_LOGINS: "yousef20920,codev-operator",
    });
  });
});
