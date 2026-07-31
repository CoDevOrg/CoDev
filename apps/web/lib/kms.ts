import "server-only";

import {
  DecryptCommand,
  GenerateDataKeyCommand,
  KMSClient,
} from "@aws-sdk/client-kms";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const LEGACY_VERSION = "v1";
const KMS_VERSION = "kms-v1";

export type KmsEncryptionContext = Record<string, string>;

let kms: KMSClient | undefined;

function getKmsKeyId() {
  const keyId = process.env.CREDENTIAL_KMS_KEY_ID;
  if (!keyId && process.env.NODE_ENV === "production") {
    throw new Error("CREDENTIAL_KMS_KEY_ID is not configured.");
  }
  return keyId;
}

function getKmsClient() {
  return (kms ??= process.env.AWS_REGION
    ? new KMSClient({ region: process.env.AWS_REGION })
    : new KMSClient());
}

function getDevelopmentKey() {
  const encoded = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!encoded) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is not configured.");
  }

  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.",
    );
  }
  return key;
}

function encryptWithKey(value: string, key: Buffer, version: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
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

function decryptWithKey(value: string, key: Buffer) {
  const [, encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  if (!encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error("The encrypted secret has an unsupported format.");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Encrypt a secret with a fresh AES-256-GCM data key protected by AWS KMS.
 * The local fallback exists only for non-production development and migration
 * compatibility; production refuses to write without a KMS key id.
 */
export async function encryptSecret(
  value: string,
  encryptionContext?: KmsEncryptionContext,
) {
  const keyId = getKmsKeyId();
  if (!keyId) return encryptWithKey(value, getDevelopmentKey(), LEGACY_VERSION);

  const dataKey = await getKmsClient().send(
    new GenerateDataKeyCommand({
      KeyId: keyId,
      KeySpec: "AES_256",
      EncryptionContext: encryptionContext,
    }),
  );
  if (!dataKey.Plaintext || !dataKey.CiphertextBlob) {
    throw new Error("AWS KMS did not return a data key.");
  }

  const plaintextKey = Buffer.from(dataKey.Plaintext);
  try {
    const encrypted = encryptWithKey(value, plaintextKey, KMS_VERSION);
    const [, iv, tag, ciphertext] = encrypted.split(".");
    return [
      KMS_VERSION,
      Buffer.from(dataKey.CiphertextBlob).toString("base64url"),
      iv,
      tag,
      ciphertext,
    ].join(".");
  } finally {
    plaintextKey.fill(0);
  }
}

/** Decrypt both KMS envelopes and legacy local envelopes during migration. */
export async function decryptSecret(
  value: string,
  encryptionContext?: KmsEncryptionContext,
) {
  const [version, ...parts] = value.split(".");
  if (version === LEGACY_VERSION) {
    return decryptWithKey(value, getDevelopmentKey());
  }
  if (version !== KMS_VERSION || parts.length !== 4) {
    throw new Error("The encrypted secret has an unsupported format.");
  }

  const [encodedDataKey, iv, tag, ciphertext] = parts;
  if (!encodedDataKey || !iv || !tag || !ciphertext) {
    throw new Error("The encrypted secret has an unsupported format.");
  }
  const dataKey = await getKmsClient().send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(encodedDataKey, "base64url"),
      EncryptionContext: encryptionContext,
    }),
  );
  if (!dataKey.Plaintext) {
    throw new Error("AWS KMS could not decrypt the credential.");
  }

  const plaintextKey = Buffer.from(dataKey.Plaintext);
  try {
    return decryptWithKey(
      [KMS_VERSION, iv, tag, ciphertext].join("."),
      plaintextKey,
    );
  } finally {
    plaintextKey.fill(0);
  }
}
