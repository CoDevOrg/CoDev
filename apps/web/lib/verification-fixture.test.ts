import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isVerificationFixtureEnabled,
  verificationFixture,
} from "./verification-fixture";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verification fixture", () => {
  it("provides stable non-secret identities and workspace data", () => {
    expect(verificationFixture).toMatchObject({
      id: "b0200000-0000-4000-8000-000000000001",
      name: "CoDev Fixture Workspace",
      repository: "acme/codev-fixture",
      branch: "main",
      workspacePath: "/workspace/codev-fixture",
      status: "Ready for browser verification",
    });
    expect(verificationFixture.members).toEqual([
      {
        id: "b0200000-0000-4000-8000-000000000011",
        name: "Alex Morgan",
        email: "alex.owner@example.test",
        role: "Owner",
      },
      {
        id: "b0200000-0000-4000-8000-000000000012",
        name: "Jordan Lee",
        email: "jordan.collaborator@example.test",
        role: "Collaborator",
      },
    ]);
    expect(verificationFixture.files).toEqual([
      "README.md",
      "src/hello.ts",
      "tests/hello.test.ts",
    ]);
    expect(
      verificationFixture.members.every((member) =>
        member.email.endsWith("@example.test"),
      ),
    ).toBe(true);
  });

  it("is enabled for local development and preview deployments", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "development");
    expect(isVerificationFixtureEnabled()).toBe(true);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(isVerificationFixtureEnabled()).toBe(true);
  });

  it("is disabled for production unless explicitly opted in", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isVerificationFixtureEnabled()).toBe(false);

    vi.stubEnv("CODEV_ENABLE_VERIFICATION_FIXTURES", "true");
    expect(isVerificationFixtureEnabled()).toBe(true);
  });
});
