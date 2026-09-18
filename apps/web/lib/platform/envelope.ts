import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * The AES-256-GCM layer shared by every envelope format.
 *
 * Only the *outer* wrapping of the per-secret data key differs between
 * providers (AWS KMS `GenerateDataKey`, Azure Key Vault `wrapKey`, or a raw
 * local key in development). Extracting this keeps those three paths from
 * each growing their own copy of the cipher handling, and keeps the wire
 * format identical across them: `<version>.<iv>.<tag>.<ciphertext>`, all
 * base64url, with provider-specific fields spliced in after the version.
 */

export const ALGORITHM = "aes-256-gcm";

export type EncryptionContext = Record<string, string>;

/**
 * Encryption context as additional authenticated data.
 *
 * AWS KMS takes the context natively and binds it to the data key. Key Vault
 * has no equivalent parameter on `wrapKey`, so the Azure path binds the same
 * context here instead, at the GCM layer. That is not a downgrade: it ties
 * the context to the *ciphertext* rather than only to the key, so a secret
 * cannot be replayed under a different workspace or user id even by someone
 * who can call unwrap. Keys are sorted so the serialisation is stable.
 */
export function canonicalContext(
  context: EncryptionContext | undefined,
): Buffer | undefined {
  if (!context) return undefined;
  const entries = Object.entries(context).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  if (entries.length === 0) return undefined;
  return Buffer.from(JSON.stringify(entries), "utf8");
}

export function encryptWithKey(
  value: string,
  key: Buffer,
  version: string,
  aad?: Buffer,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    version,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptWithKey(value: string, key: Buffer, aad?: Buffer) {
  const [, encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  if (!encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error("The encrypted secret has an unsupported format.");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(encodedIv, "base64url"),
  );
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
