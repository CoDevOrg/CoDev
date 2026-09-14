import "server-only";

import {
  DecryptCommand,
  GenerateDataKeyCommand,
  KMSClient,
} from "@aws-sdk/client-kms";

import { getAwsConfiguration } from "./aws";
import { credentialStorageNotConfigured } from "./credential-storage-error";
import {
  decryptWithKey,
  encryptWithKey,
  type EncryptionContext,
} from "./envelope";

/**
 * Envelope encryption against AWS KMS. Extracted unchanged from `kms.ts` when
 * the Azure path arrived; `kms.ts` now dispatches to this or to
 * `azure-kms.ts`.
 */

export const KMS_VERSION = "kms-v1";

let kms: KMSClient | undefined;

export function getKmsKeyId() {
  const keyId = process.env.CREDENTIAL_KMS_KEY_ID;
  if (!keyId && process.env.NODE_ENV === "production") {
    throw credentialStorageNotConfigured("CREDENTIAL_KMS_KEY_ID");
  }
  return keyId;
}

function getKmsClient() {
  return (kms ??= new KMSClient(getAwsConfiguration()));
}

export async function encryptWithKms(
  value: string,
  encryptionContext?: EncryptionContext,
) {
  const keyId = getKmsKeyId();
  if (!keyId) throw credentialStorageNotConfigured("CREDENTIAL_KMS_KEY_ID");

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

export async function decryptWithKms(
  value: string,
  encryptionContext?: EncryptionContext,
) {
  const [, ...parts] = value.split(".");
  if (parts.length !== 4) {
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
