export type VerificationFixtureMember = {
  id: string;
  name: string;
  email: string;
  role: "Owner" | "Collaborator";
};

export const verificationFixture = {
  id: "b0200000-0000-4000-8000-000000000001",
  name: "CoDev Fixture Workspace",
  repository: "acme/codev-fixture",
  branch: "main",
  workspacePath: "/workspace/codev-fixture",
  status: "Ready for browser verification",
  members: [
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
  ] satisfies VerificationFixtureMember[],
  files: ["README.md", "src/hello.ts", "tests/hello.test.ts"],
} as const;

/**
 * Keep the fixture available for local development and Vercel previews, but
 * never expose it from the production deployment unless explicitly opted in.
 */
export function isVerificationFixtureEnabled() {
  const override = process.env.CODEV_ENABLE_VERIFICATION_FIXTURES;
  if (override === "true") return true;
  if (override === "false") return false;
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.VERCEL_ENV === "preview"
  );
}
