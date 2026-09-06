import "server-only";

import { and, eq, isNull, lt, or } from "drizzle-orm";

import { schema } from "@codev/db";

import { ClaudeConnectionError } from "./claude-connection";
import { getDatabase } from "./database";

/**
 * A Claude Pro/Max subscription is a human seat, not a shared backend pool:
 * Anthropic rate-limits it accordingly. So a connected subscription runs at
 * most one CoDev cloud turn at a time — the same row-level lease the hosted
 * Codex subscription uses (`unavailableUntil` on the credential row). A second
 * turn that arrives while one is running is rejected and retried, not fanned
 * out in parallel.
 */
const LEASE_MS = 10 * 60 * 1_000;

/**
 * Take the execution lease on a connected Claude subscription credential.
 * Throws {@link ClaudeConnectionError} (429) if another turn already holds it
 * or the credential is not an active Anthropic OAuth connection.
 */
export async function claimClaudeSubscriptionExecution(credentialId: string) {
  const [claimed] = await getDatabase()
    .update(schema.providerCredentials)
    .set({
      unavailableUntil: new Date(Date.now() + LEASE_MS),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.providerCredentials.id, credentialId),
        eq(schema.providerCredentials.provider, "anthropic"),
        eq(schema.providerCredentials.credentialType, "OAUTH_TOKEN"),
        eq(schema.providerCredentials.status, "active"),
        eq(schema.providerCredentials.isConnected, true),
        or(
          isNull(schema.providerCredentials.unavailableUntil),
          lt(schema.providerCredentials.unavailableUntil, new Date()),
        ),
      ),
    )
    .returning({ id: schema.providerCredentials.id });
  if (!claimed) {
    throw new ClaudeConnectionError(
      "Your Claude subscription is already running another cloud turn. Try again shortly.",
      429,
    );
  }
}

/** Release the execution lease. Safe to call more than once. */
export async function releaseClaudeSubscriptionExecution(credentialId: string) {
  await getDatabase()
    .update(schema.providerCredentials)
    .set({ unavailableUntil: null, updatedAt: new Date() })
    .where(eq(schema.providerCredentials.id, credentialId));
}
