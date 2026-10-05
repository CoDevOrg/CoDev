import "server-only";
import { runtimeEnvironment } from "../platform/runtime-environment";

import { ArmWorkspaceRuntimeError } from "./arm-workspace-error";

function fail(code: string): never {
  throw new ArmWorkspaceRuntimeError(code);
}

export function readArmWorkspaceConfig() {
  const environment = runtimeEnvironment();
  const required = (name: string) => {
    const value = environment[name]?.trim();
    if (!value) fail("RUNTIME_CONFIGURATION_MISSING");
    return value;
  };
  const config = {
    tenantId: required("AZURE_TENANT_ID"),
    clientId: required("ARM_WORKSPACE_AZURE_CLIENT_ID"),
    clientSecret: required("ARM_WORKSPACE_AZURE_CLIENT_SECRET"),
    subscriptionId: required("AZURE_SUBSCRIPTION_ID"),
    resourceGroup: required("ARM_WORKSPACE_RESOURCE_GROUP"),
    imageVersionId: required("ARM_WORKSPACE_IMAGE_VERSION_ID"),
    sshPublicKey: required("ARM_WORKSPACE_SSH_PUBLIC_KEY"),
    signingPrivateKey: required("ARM_WORKSPACE_SIGNING_PRIVATE_KEY"),
    signingPublicKey: required("ARM_WORKSPACE_SIGNING_PUBLIC_KEY"),
    cloudflareToken: required("CLOUDFLARE_API_TOKEN"),
  };
  if (
    !/^codev-arm-workspace-[a-z0-9-]+$/.test(config.resourceGroup) ||
    !config.imageVersionId.startsWith(
      `/subscriptions/${config.subscriptionId}/resourceGroups/`,
    ) ||
    !/^\/subscriptions\/[^/]+\/resourceGroups\/codev-arm-workspace-[a-z0-9-]+\/providers\/Microsoft\.Compute\/galleries\/[^/]+\/images\/[^/]+\/versions\/\d+\.\d+\.\d+$/.test(
      config.imageVersionId,
    ) ||
    !config.signingPublicKey.includes("BEGIN PUBLIC KEY") ||
    !config.sshPublicKey.startsWith("ssh-")
  ) {
    fail("RUNTIME_CONFIGURATION_INVALID");
  }
  return config;
}
