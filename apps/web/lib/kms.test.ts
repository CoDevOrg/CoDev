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
  vi.clearAllMocks();
});

describe("KMS secret encryption", () => {
  it("creates the client with the shared AWS configuration", async () => {
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
