import "server-only";

import {
  ClientAssertionCredential,
  DefaultAzureCredential,
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
 * Nothing here can hold a long-lived secret. `ClientAssertionCredential`
 * takes a *callback* rather than a client secret, and that callback returns
 * Vercel's request-scoped OIDC token, so there is no Azure client secret to
 * store in Vercel's environment, rotate, or leak. The federated credential on
 * the app registration is what trusts this exchange, matched on the exact
 * subject `owner:<team>:project:<project>:environment:<env>`.
 */
let credential: TokenCredential | undefined;

export function getAzureCredential(): TokenCredential {
  if (credential) return credential;

  const environment = readServerEnvironment();
  const tenantId = environment.AZURE_TENANT_ID;
  const clientId = environment.AZURE_CLIENT_ID;

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
