import "server-only";

/**
 * The error raised when the managed key that wraps stored credentials is not
 * configured.
 *
 * These throws sit under `encryptSecret`, which is reached from ordinary
 * product actions — connecting a provider, signing in with GitHub, saving an
 * environment variable. `apiError` renders `Error.message` in the browser, so
 * the old message put "CREDENTIAL_KEY_VAULT_KEY_ID is not configured." in
 * front of a member who has no key vault, no deployment, and nothing to do
 * about it. The variable name is what an operator needs, so it goes to the
 * server log; the reader gets a sentence that names the thing that failed and
 * whose problem it is.
 */
export function credentialStorageNotConfigured(variable: string) {
  console.error(
    `[credentials] ${variable} is not configured; secrets cannot be encrypted.`,
  );
  return new Error(
    "Credential storage isn't configured on this server, so it can't store secrets securely. Please contact support.",
  );
}
