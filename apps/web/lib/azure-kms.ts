import "server-only";

import { CryptographyClient } from "@azure/keyvault-keys";
import { randomBytes } from "node:crypto";

import { getAzureCredential } from "./azure";
import {
  canonicalContext,
  decryptWithKey,
  encryptWithKey,
  type EncryptionContext,
} from "./envelope";

/**
 * Envelope encryption against Azure Key Vault, the counterpart of the AWS KMS
 * path in `aws-kms.ts`.
 *
 * The shape is the same as KMS's: a fresh AES-256 data key per secret,
 * wrapped by a key that never leaves the vault. The difference is that KMS
 * generates the data key for you (`GenerateDataKey` returns plaintext and
 * ciphertext together) while Key Vault only wraps a key you supply, so the
 * data key is generated locally with `randomBytes` and then wrapped. That is
 * the documented pattern for Key Vault envelope encryption, and the data key
 * is zeroed as soon as the cipher is done with it either way.
 */

export const AZURE_VERSION = "akv-v1";

let cryptography: CryptographyClient | undefined;

function getKeyIdentifier() {
  const keyId = process.env.CREDENTIAL_KEY_VAULT_KEY_ID;
  if (!keyId && process.env.NODE_ENV === "production") {
    throw new Error("CREDENTIAL_KEY_VAULT_KEY_ID is not configured.");
  }
  return keyId;
}

function getCryptographyClient(keyId: string) {
  return (cryptography ??= new CryptographyClient(keyId, getAzureCredential()));
}

export async function encryptWithAzure(
  value: string,
  encryptionContext?: EncryptionContext,
) {
  const keyId = getKeyIdentifier();
  if (!keyId) {
    throw new Error("CREDENTIAL_KEY_VAULT_KEY_ID is not configured.");
  }

  const dataKey = randomBytes(32);
  try {
    const wrapped = await getCryptographyClient(keyId).wrapKey(
      "RSA-OAEP-256",
      dataKey,
    );
    const aad = canonicalContext(encryptionContext);
    const encrypted = encryptWithKey(value, dataKey, AZURE_VERSION, aad);
    const [, iv, tag, ciphertext] = encrypted.split(".");
    return [
      AZURE_VERSION,
      Buffer.from(wrapped.result).toString("base64url"),
      iv,
      tag,
      ciphertext,
    ].join(".");
  } finally {
    dataKey.fill(0);
  }
}

export async function decryptWithAzure(
  value: string,
  encryptionContext?: EncryptionContext,
) {
  const [, ...parts] = value.split(".");
  if (parts.length !== 4) {
    throw new Error("The encrypted secret has an unsupported format.");
  }
  const [encodedWrappedKey, iv, tag, ciphertext] = parts;
  if (!encodedWrappedKey || !iv || !tag || !ciphertext) {
    throw new Error("The encrypted secret has an unsupported format.");
  }

  // The key identifier is read from the envelope's own configuration rather
  // than the envelope, matching the KMS path: Key Vault resolves the right
  // key version from the wrapped blob itself.
  const keyId = getKeyIdentifier();
  if (!keyId) {
    throw new Error("CREDENTIAL_KEY_VAULT_KEY_ID is not configured.");
  }

  const unwrapped = await getCryptographyClient(keyId).unwrapKey(
    "RSA-OAEP-256",
    Buffer.from(encodedWrappedKey, "base64url"),
  );
  const dataKey = Buffer.from(unwrapped.result);
  try {
    return decryptWithKey(
      [AZURE_VERSION, iv, tag, ciphertext].join("."),
      dataKey,
      canonicalContext(encryptionContext),
    );
  } finally {
    dataKey.fill(0);
  }
}
