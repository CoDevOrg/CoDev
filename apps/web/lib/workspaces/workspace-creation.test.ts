import { describe, expect, it } from "vitest";

import { workspaceCreateRequestSchema } from "./workspace-creation";

describe("workspace creation input", () => {
  it("allows an empty workspace", () => {
    expect(workspaceCreateRequestSchema.parse({})).toEqual({});
  });

  it("requires the installation and repository together", () => {
    expect(
      workspaceCreateRequestSchema.parse({
        installationId: 42,
        repositoryId: 99,
      }),
    ).toEqual({ installationId: 42, repositoryId: 99 });

    expect(() =>
      workspaceCreateRequestSchema.parse({ installationId: 42 }),
    ).toThrow("Choose a repository installation and repository together");
  });
});
