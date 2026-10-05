import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { capabilityToken } from "./arm-workspace-provider";

afterEach(() => vi.unstubAllEnvs());
it("signs workspace commands with exact method, raw path, bytes, identity and expiry", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const values = {
    AZURE_TENANT_ID: "tenant",
    ARM_WORKSPACE_AZURE_CLIENT_ID: "client",
    ARM_WORKSPACE_AZURE_CLIENT_SECRET: "fixture",
    AZURE_SUBSCRIPTION_ID: "subscription",
    ARM_WORKSPACE_RESOURCE_GROUP: "codev-arm-workspace-test",
    ARM_WORKSPACE_IMAGE_VERSION_ID:
      "/subscriptions/subscription/resourceGroups/codev-arm-workspace-test/providers/Microsoft.Compute/galleries/gallery/images/image/versions/1.0.10",
    ARM_WORKSPACE_SSH_PUBLIC_KEY: "ssh-ed25519 fixture",
    ARM_WORKSPACE_SIGNING_PRIVATE_KEY: privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64"),
    ARM_WORKSPACE_SIGNING_PUBLIC_KEY: publicKey
      .export({ format: "pem", type: "spki" })
      .toString(),
    CLOUDFLARE_API_TOKEN: "fixture",
  };
  Object.entries(values).forEach(([name, value]) => vi.stubEnv(name, value));
  const request = {
    method: "POST",
    path: "/v1/files/write",
    scope: "workspace",
    body: JSON.stringify({ contents: "édit", expectedRevision: "r1" }),
  };
  const token = await capabilityToken(
    "runtime.trycodev.com",
    "workspace-a",
    2,
    request,
  );
  const [header, payload, signature] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
  expect(claims).toMatchObject({
    iss: "codev-control-plane",
    aud: "runtime.trycodev.com",
    workspaceId: "workspace-a",
    generation: 2,
    method: request.method,
    path: request.path,
    scope: "workspace",
    bodySha256: createHash("sha256").update(request.body).digest("hex"),
  });
  expect(claims.exp - claims.iat).toBe(60);
  expect(
    verify(
      null,
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature!, "base64url"),
    ),
  ).toBe(true);
});
