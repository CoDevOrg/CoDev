import { z } from "zod";

export const workspaceCreateRequestSchema = z
  .object({
    installationId: z.number().int().positive().optional(),
    repositoryId: z.number().int().positive().optional(),
  })
  .refine(
    (input) =>
      (input.installationId === undefined) ===
      (input.repositoryId === undefined),
    "Choose a repository installation and repository together, or create an empty workspace.",
  );
