import { z } from "zod";

/**
 * Identifiers shared by gen2.ts and the feature contracts that gen2.ts itself
 * imports. They live in this leaf module so neither side has to import the
 * other; gen2.ts re-exports them, so callers keep importing from the package.
 */

export const gen2WorkspaceRoleSchema = z.enum(["owner", "editor", "viewer"]);

/** The agents a Gen 2 turn can run, in the order the composer lists them.
 *  A registry test holds this list to the providers whose credentials the
 *  `gen2` executor can run, so it cannot drift from what settings shows. */
export const GEN2_AGENT_PROVIDERS = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude" },
  { id: "cursor", label: "Cursor" },
] as const;

export const gen2AgentProviderSchema = z.enum(
  GEN2_AGENT_PROVIDERS.map((provider) => provider.id) as [
    (typeof GEN2_AGENT_PROVIDERS)[number]["id"],
    ...(typeof GEN2_AGENT_PROVIDERS)[number]["id"][],
  ],
);

/** Matches the guest's safe worktree directory identifier. */
export const gen2SupersetWorktreeIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);

/** A branch name Git and the guest's worktree command both accept. */
export const gen2BranchNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !value.startsWith("-") &&
      !value.includes("..") &&
      !/[~^:?*[\\\s]/.test(value) &&
      !value.endsWith(".") &&
      !value.endsWith("/"),
    "Branch name is invalid.",
  );
