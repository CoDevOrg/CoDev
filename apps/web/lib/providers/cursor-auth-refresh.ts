import "server-only";

import { and, eq } from "drizzle-orm";
import { schema } from "@codev/db";
import { getDatabase } from "../platform/database";
import { encryptSecret } from "../platform/kms";
import { validateCursorAuthCache } from "./cursor-cli-auth";

/** Refresh an existing login without restoring a revoked connection or changing sharing. */
export async function updateCursorAuthCache(userId: string, contents: string) {
  const auth = validateCursorAuthCache(JSON.parse(contents));
  const encryptedAccessToken = await encryptSecret(auth.serialized, {
    application: "codev",
    purpose: "provider-credential",
  });
  await getDatabase()
    .update(schema.providerCredentials)
    .set({
      encryptedAccessToken,
      lastFour: auth.lastFour,
      lastRefreshedAt: new Date(),
    })
    .where(
      and(
        eq(schema.providerCredentials.scopeType, "USER"),
        eq(schema.providerCredentials.scopeId, userId),
        eq(schema.providerCredentials.provider, "cursor"),
        eq(schema.providerCredentials.credentialType, "OAUTH_TOKEN"),
        eq(schema.providerCredentials.status, "active"),
        eq(schema.providerCredentials.isConnected, true),
      ),
    );
}
