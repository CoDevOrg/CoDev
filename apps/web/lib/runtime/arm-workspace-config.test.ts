import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readArmWorkspaceConfig } from "./arm-workspace-config";

const image =
  "/subscriptions/subscription/resourceGroups/codev-arm-workspace-phase1/providers/Microsoft.Compute/galleries/gallery/images/image/versions/1.0.11";
beforeEach(() => {
  Object.entries({
    AZURE_TENANT_ID: "tenant",
    AZURE_SUBSCRIPTION_ID: "subscription",
    AZURE_CLIENT_ID: "firecracker",
    AZURE_CLIENT_SECRET: "firecracker-secret",
    AZURE_RESOURCE_GROUP: "codev-runtime-migration",
    ARM_WORKSPACE_AZURE_CLIENT_ID: "arm",
    ARM_WORKSPACE_AZURE_CLIENT_SECRET: "arm-secret",
    ARM_WORKSPACE_RESOURCE_GROUP: "codev-arm-workspace-staging",
    ARM_WORKSPACE_IMAGE_VERSION_ID: image,
    ARM_WORKSPACE_SSH_PUBLIC_KEY: "ssh-ed25519 fixture",
    ARM_WORKSPACE_SIGNING_PRIVATE_KEY: "fixture",
    ARM_WORKSPACE_SIGNING_PUBLIC_KEY: "BEGIN PUBLIC KEY",
    CLOUDFLARE_API_TOKEN: "fixture",
  }).forEach(([key, value]) => vi.stubEnv(key, value));
});
afterEach(() => vi.unstubAllEnvs());

it("isolates ARM credentials and accepts the build-group image for staging", () => {
  expect(readArmWorkspaceConfig()).toMatchObject({
    clientId: "arm",
    clientSecret: "arm-secret",
    resourceGroup: "codev-arm-workspace-staging",
    imageVersionId: image,
  });
});
it.each([
  "ARM_WORKSPACE_AZURE_CLIENT_ID",
  "ARM_WORKSPACE_AZURE_CLIENT_SECRET",
  "ARM_WORKSPACE_RESOURCE_GROUP",
])("does not fall back when %s is missing", (key) => {
  vi.stubEnv(key, "");
  expect(readArmWorkspaceConfig).toThrow("RUNTIME_CONFIGURATION_MISSING");
});
it.each([
  image.replace("/subscriptions/subscription/", "/subscriptions/other/"),
  image.replace("codev-arm-workspace-phase1", "codev-runtime-migration"),
  `${image}/extra`,
])("rejects an image outside the permitted ARM image scope", (value) => {
  vi.stubEnv("ARM_WORKSPACE_IMAGE_VERSION_ID", value);
  expect(readArmWorkspaceConfig).toThrow("RUNTIME_CONFIGURATION_INVALID");
});
