import "server-only";

import {
  ClientAssertionCredential,
  DefaultAzureCredential,
  ManagedIdentityCredential,
  type TokenCredential,
} from "@azure/identity";
import { readServerEnvironment } from "@codev/config";
import { getVercelOidcToken } from "@vercel/oidc";

/**
 * The Azure counterpart of `getAwsConfiguration`, and deliberately the same
 * shape of decision: on Vercel, exchange the platform's short-lived OIDC
 * token for Azure credentials through workload identity federation; anywhere
 * else, fall back to the ambient developer chain (`az login`, a managed
 * identity on a VM, or environment variables).
 *
 * On Vercel there is no long-lived secret. `ClientAssertionCredential` takes a
 * callback that returns Vercel's request-scoped OIDC token. The Worker cannot
 * obtain that token, so it uses a separate app registration that can unwrap
 * Key Vault keys and start or stop the Firecracker host VM.
 */
let credential: TokenCredential | undefined;

function onCloudflareWorker() {
  return (
    typeof navigator !== "undefined" &&
    navigator.userAgent === "Cloudflare-Workers"
  );
}

/**
 * The Worker cannot call `getVercelOidcToken`. It exchanges a client secret
 * for a short-lived Azure token instead. The secret belongs to an app
 * registration that can unwrap keys and operate the Firecracker host VM.
 */
export function createClientSecretCredential(
  tenantId: string,
  clientId: string,
  clientSecret: string,
): TokenCredential {
  let cached: { token: string; expiresOnTimestamp: number } | undefined;
  return {
    async getToken(scopes) {
      const now = Date.now();
      if (cached && cached.expiresOnTimestamp - 60_000 > now) return cached;
      const scope = Array.isArray(scopes) ? scopes.join(" ") : scopes;
      const response = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "client_credentials",
            scope,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        access_token?: string;
        expires_in?: number;
      } | null;
      if (!response.ok || !payload?.access_token) {
        throw new Error("Azure credentials are not configured for Cloudflare.");
      }
      cached = {
        token: payload.access_token,
        expiresOnTimestamp: now + (payload.expires_in ?? 3600) * 1000,
      };
      return cached;
    },
  };
}

export function getAzureCredential(): TokenCredential {
  if (credential) return credential;

  const environment = readServerEnvironment();
  const tenantId = environment.AZURE_TENANT_ID;
  const clientId = environment.AZURE_CLIENT_ID;

  // Container Apps supplies this endpoint for its managed identity; it has no
  // Vercel assertion token and must not select the federation path below.
  if (process.env.IDENTITY_ENDPOINT) {
    credential = new ManagedIdentityCredential(clientId ? { clientId } : {});
    return credential;
  }

  if (onCloudflareWorker()) {
    const clientSecret = environment.AZURE_CLIENT_SECRET;
    if (!tenantId || !clientId || !clientSecret) {
      throw new Error("Azure credentials are not configured for Cloudflare.");
    }
    credential = createClientSecretCredential(tenantId, clientId, clientSecret);
    return credential;
  }

  if (tenantId && clientId) {
    credential = new ClientAssertionCredential(
      tenantId,
      clientId,
      getVercelOidcToken,
    );
    return credential;
  }

  // Local development and CI, where `az login` or a managed identity already
  // supplies an identity. Production refuses to reach this branch: see
  // `getAzureSubscriptionId`, which throws without the configuration that
  // accompanies a real deployment.
  credential = new DefaultAzureCredential();
  return credential;
}

export function getAzureSubscriptionId(): string {
  const subscriptionId = readServerEnvironment().AZURE_SUBSCRIPTION_ID;
  if (!subscriptionId) {
    throw new Error("AZURE_SUBSCRIPTION_ID is not configured.");
  }
  return subscriptionId;
}

export function getAzureResourceGroup(): string {
  const resourceGroup = readServerEnvironment().AZURE_RESOURCE_GROUP;
  if (!resourceGroup) {
    throw new Error("AZURE_RESOURCE_GROUP is not configured.");
  }
  return resourceGroup;
}
