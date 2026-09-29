/**
 * Test double for `@azure/arm-compute` — see `azure-keyvault-keys.ts`. No
 * test provisions a VM; reaching the management plane throws.
 */
export class ComputeManagementClient {
  constructor(
    readonly credential: unknown,
    readonly subscriptionId: string,
  ) {}

  get virtualMachines(): never {
    throw new Error("Azure Compute is not available in tests.");
  }

  get disks(): never {
    throw new Error("Azure Compute is not available in tests.");
  }

  get snapshots(): never {
    throw new Error("Azure Compute is not available in tests.");
  }
}
