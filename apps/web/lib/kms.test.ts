import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  awsConfiguration: {
    region: "us-east-2",
    credentials: { get: vi.fn() },
  },
  clientConfiguration: undefined as unknown,
  send: vi.fn(),
}));

vi.mock("./aws", () => ({
  getAwsConfiguration: vi.fn(() => mocks.awsConfiguration),
}));

vi.mock("@aws-sdk/client-kms", () => {
  class MockKMSClient {
    constructor(configuration: unknown) {
      mocks.clientConfiguration = configuration;
    }

    send(...args: unknown[]) {
      return mocks.send(...args);
    }
  }

  class MockGenerateDataKeyCommand {
    constructor(public readonly input: unknown) {}
  }

  class MockDecryptCommand {
    constructor(public readonly input: unknown) {}
  }

  return {
    DecryptCommand: MockDecryptCommand,
    GenerateDataKeyCommand: MockGenerateDataKeyCommand,
    KMSClient: MockKMSClient,
  };
});

import { encryptSecret } from "./kms";

afterEach(() => {
  delete process.env.CREDENTIAL_KMS_KEY_ID;
  delete process.env.CLOUD_PROVIDER;
  delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  vi.clearAllMocks();
});

describe("local development fallback", () => {
  /**
   * The development fallback used to live inside the AWS branch. When the
   * default cloud moved to Azure, an unconfigured local checkout — no Key
   * Vault key, no KMS key — began throwing on the first credential it stored,
   * because the Azure path demanded a managed key where AWS had not. Both
   * clouds fall back for a developer, and neither does in production.
   */
  it("writes a development envelope on Azure with no Key Vault key", async () => {
    process.env.CLOUD_PROVIDER = "azure";
    process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString(
      "base64",
    );

    const encrypted = await encryptSecret("github-access-token");

    expect(encrypted.startsWith("kms-v1.")).toBe(false);
    expect(encrypted.startsWith("azure-v1.")).toBe(false);
  });
});

describe("KMS secret encryption", () => {
  it("creates the client with the shared AWS configuration", async () => {
    // This file is about the AWS envelope specifically, so it names the cloud
    // rather than leaning on the default — which is Azure now that the
    // migration is done. Reads still dispatch on the stored version prefix,
    // so `kms-v1.` envelopes keep decrypting whatever the current provider is.
    process.env.CLOUD_PROVIDER = "aws";
    process.env.CREDENTIAL_KMS_KEY_ID = "test-kms-key";
    mocks.send.mockResolvedValue({
      Plaintext: Buffer.alloc(32, 7),
      CiphertextBlob: Buffer.from("encrypted-data-key"),
    });

    const encrypted = await encryptSecret("github-access-token");

    expect(encrypted.startsWith("kms-v1.")).toBe(true);
    expect(mocks.clientConfiguration).toBe(mocks.awsConfiguration);
    expect(mocks.send).toHaveBeenCalledOnce();
  });
});
