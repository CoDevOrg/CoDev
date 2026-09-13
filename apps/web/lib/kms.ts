import "server-only";

import { AZURE_VERSION, decryptWithAzure, encryptWithAzure } from "./azure-kms";
import {
  decryptWithKms,
  encryptWithKms,
  getKmsKeyId,
  KMS_VERSION,
} from "./aws-kms";
import { isAzure } from "./cloud";
import {
  decryptWithKey,
  encryptWithKey,
  type EncryptionContext,
} from "./envelope";

/**
 * Credential encryption, whichever cloud holds the key.
 *
 * The asymmetry here is deliberate and is what makes the AWS-to-Azure cutover
 * survivable. **Writes** follow `CLOUD_PROVIDER`: new secrets are wrapped by
 * whichever provider is current. **Reads** follow the envelope's own version
 * prefix, so a secret written under AWS KMS months ago stays readable after
 * the switch without a migration having to run first, and a rollback to AWS
 * leaves Azure-written secrets readable too.
 *
 * Without that split, flipping the provider would brick every stored
 * credential the instant it happened. With it, `scripts/rewrap-credentials.ts`
 * becomes an optimisation you run at leisure rather than a gate on the
 * cutover.
 */

export type KmsEncryptionContext = EncryptionContext;

const LEGACY_VERSION = "v1";

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

/**
 * Encrypt a secret with a fresh AES-256-GCM data key held by the configured
 * cloud's key service. The local fallback exists only for non-production
 * development and migration compatibility; production refuses to write
 * without a managed key.
 */
export async function encryptSecret(
  value: string,
  encryptionContext?: KmsEncryptionContext,
) {
  if (isAzure()) {
    return encryptWithAzure(value, encryptionContext);
  }

  const keyId = getKmsKeyId();
  if (!keyId) return encryptWithKey(value, getDevelopmentKey(), LEGACY_VERSION);
  return encryptWithKms(value, encryptionContext);
}

/**
 * Decrypt any envelope this codebase has ever written: the local development
 * format, the AWS KMS format, and the Azure Key Vault format. Dispatch is on
 * the stored version prefix, never on the current provider.
 */
export async function decryptSecret(
  value: string,
  encryptionContext?: KmsEncryptionContext,
) {
  const [version] = value.split(".");

  if (version === LEGACY_VERSION) {
    return decryptWithKey(value, getDevelopmentKey());
  }
  if (version === KMS_VERSION) {
    return decryptWithKms(value, encryptionContext);
  }
  if (version === AZURE_VERSION) {
    return decryptWithAzure(value, encryptionContext);
  }
  throw new Error("The encrypted secret has an unsupported format.");
}

/** Which provider wrote a stored secret. Used by the re-wrap script. */
export function envelopeProvider(value: string) {
  const [version] = value.split(".");
  if (version === KMS_VERSION) return "aws" as const;
  if (version === AZURE_VERSION) return "azure" as const;
  if (version === LEGACY_VERSION) return "local" as const;
  return "unknown" as const;
}
