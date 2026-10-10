import "server-only";

import { readArmWorkspaceConfig } from "./arm-workspace-config";

const ISSUER = "codev-control-plane";
/** Guests reject control-plane tokens that live longer than this. */
const LIFETIME_SECONDS = 60;

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

/**
 * A compact EdDSA JWT signed with the control plane's ARM key. Guests verify
 * it with the public key they receive at boot. Callers bind it to one use
 * through `aud` and `scope` (gateway capabilities, preview sessions), so a
 * token minted for one guest service is rejected by every other.
 */
export async function signArmControlPlaneToken(
  claims: Record<string, unknown>,
) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(readArmWorkspaceConfig().signingPrivateKey),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const encodeJson = (value: unknown) =>
    base64Url(new TextEncoder().encode(JSON.stringify(value)));
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: "EdDSA", typ: "JWT" });
  const payload = encodeJson({
    ...claims,
    iss: ISSUER,
    iat: issuedAt,
    exp: issuedAt + LIFETIME_SECONDS,
  });
  const message = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    key,
    new TextEncoder().encode(message),
  );
  return `${message}.${base64Url(new Uint8Array(signature))}`;
}
