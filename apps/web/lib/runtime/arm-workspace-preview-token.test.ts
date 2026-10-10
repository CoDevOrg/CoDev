import { generateKeyPairSync, verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { armWorkspacePreviewToken } from "./arm-workspace-preview-token";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const host = "p3000-0123456789abcdef0123-g3.codev-preview.dev";
const input = {
  host,
  workspaceId: "ws-a",
  generation: 3,
  port: 3000,
  userId: "user-1",
  appOrigin: "https://www.trycodev.com",
};

beforeEach(() => {
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
});
afterEach(() => vi.unstubAllEnvs());

describe("preview tokens", () => {
  it("signs a one-minute, single-use token bound to one host, port and member", async () => {
    const token = await armWorkspacePreviewToken(input);
    const [header, payload, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      alg: "EdDSA",
      typ: "JWT",
    });
    expect(claims).toEqual({
      iss: "codev-control-plane",
      aud: host,
      scope: "preview",
      workspaceId: "ws-a",
      generation: 3,
      port: 3000,
      sub: "user-1",
      appOrigin: "https://www.trycodev.com",
      jti: expect.stringMatching(/^[0-9a-f-]{36}$/),
      iat: expect.any(Number),
      exp: claims.iat + 60,
    });
    expect(claims).not.toHaveProperty("method");
    expect(
      verify(
        null,
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
    expect(await armWorkspacePreviewToken(input)).not.toBe(token);
  });
});
