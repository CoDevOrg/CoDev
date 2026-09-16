import "server-only";

import {
  AZURE_VERSION,
  decryptWithAzure,
  encryptWithAzure,
  getKeyVaultKeyId,
} from "./azure-kms";
import {
  decryptWithKey,
  encryptWithKey,
  type EncryptionContext,
} from "./envelope";

/**
 * Credential encryption, wrapped by Azure Key Vault.
 *
 * This used to dispatch on `CLOUD_PROVIDER` for writes while decrypting on
 * each envelope's own version prefix, so that AWS-wrapped secrets survived
 * the cutover to Azure and Azure-wrapped ones would survive a rollback. That
 * asymmetry did its job: production now holds no `kms-v1` envelope at all,
 * every stored credential is `akv-v1`, and the AWS key is scheduled for
 * deletion. So the AWS half is gone, along with the re-wrap script whose
 * whole purpose was to empty it.
 *
 * The local development format is still read below, because it is not an AWS
 * thing -- it is what an unconfigured checkout writes.
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
  // An unconfigured local checkout has no Key Vault key and falls back to the
  // development format. Production refuses either way: `getKeyVaultKeyId` and
  // `getDevelopmentKey` both throw there rather than write an unmanaged
  // envelope.
  const keyId = getKeyVaultKeyId();
  if (!keyId) return encryptWithKey(value, getDevelopmentKey(), LEGACY_VERSION);
  return encryptWithAzure(value, encryptionContext);
}

/**
 * Decrypt any envelope still in use: the local development format and the
 * Azure Key Vault format. Dispatch is on the stored version prefix, which is
 * what let the `kms-v1` format be dropped once nothing carried it.
 */
export async function decryptSecret(
  value: string,
  encryptionContext?: KmsEncryptionContext,
) {
  const [version] = value.split(".");

  if (version === LEGACY_VERSION) {
    return decryptWithKey(value, getDevelopmentKey());
  }
  if (version === AZURE_VERSION) {
    return decryptWithAzure(value, encryptionContext);
  }
  throw new Error("The encrypted secret has an unsupported format.");
}
