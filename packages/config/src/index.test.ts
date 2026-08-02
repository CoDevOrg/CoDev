import { describe, expect, it } from "vitest";

import {
  isGitHubAuthConfigured,
  isGoogleAuthConfigured,
  readServerEnvironment,
} from "./index";

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

  it("recognizes complete Google OAuth configuration", () => {
    expect(
      isGoogleAuthConfigured({
        AUTH_SECRET: "a-secret",
        AUTH_GOOGLE_ID: "google-client-id",
        AUTH_GOOGLE_SECRET: "google-client-secret",
      }),
    ).toBe(true);
    expect(
      isGoogleAuthConfigured({
        AUTH_SECRET: "a-secret",
        AUTH_GOOGLE_ID: "google-client-id",
      }),
    ).toBe(false);
  });

  it("requires KMS-backed token storage for production GitHub OAuth", () => {
    const base = {
      NODE_ENV: "production",
      AUTH_SECRET: "a-secret",
      AUTH_GITHUB_ID: "github-client-id",
      AUTH_GITHUB_SECRET: "github-client-secret",
      CREDENTIAL_ENCRYPTION_KEY: "development-fallback-key",
    };

    expect(isGitHubAuthConfigured(base)).toBe(false);
    expect(
      isGitHubAuthConfigured({
        ...base,
        CREDENTIAL_KMS_KEY_ID: "arn:aws:kms:us-east-2:014576992564:key/example",
      }),
    ).toBe(true);
  });
});
