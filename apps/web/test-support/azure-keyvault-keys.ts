/**
 * Test double for `@azure/keyvault-keys`.
 *
 * The real package's ESM entry takes a named import from its own CommonJS
 * state module (`../commonjs/state-cjs.js`), which Node cannot synthesise —
 * so every test whose imports reached `lib/platform/azure-kms` died at import
 * time, which is most of `lib/providers`. Inlining it for Vite only moved the
 * failure into the package's TypeScript source.
 *
 * No test signs anything against a real Key Vault: `lib/platform/kms` selects
 * the Azure path from configuration, and the unit tests exercise the local
 * path. This stub keeps the module graph loadable and fails loudly if a test
 * ever does reach the vault.
 */
export class CryptographyClient {
  constructor(
    readonly keyId: string,
    readonly credential: unknown,
  ) {}

  wrapKey(): never {
    throw new Error("Azure Key Vault is not available in tests.");
  }

  unwrapKey(): never {
    throw new Error("Azure Key Vault is not available in tests.");
  }
}
