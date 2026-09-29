/**
 * Test double for `@azure/identity` — see `azure-keyvault-keys.ts` for why
 * the real package cannot be imported under Vitest. No test authenticates
 * against Azure; a credential that is actually used throws rather than
 * silently reaching the network.
 */
export type TokenCredential = {
  getToken: () => Promise<{ token: string; expiresOnTimestamp: number }>;
};

function unavailable(): never {
  throw new Error("Azure credentials are not available in tests.");
}

export class DefaultAzureCredential {
  getToken = unavailable;
}

export class ClientAssertionCredential {
  constructor(
    readonly tenantId: string,
    readonly clientId: string,
    readonly getAssertion: () => Promise<string>,
  ) {}
  getToken = unavailable;
}
