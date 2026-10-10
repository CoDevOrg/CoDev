import { describe, expect, it, vi } from "vitest";

vi.mock("../platform/database", () => ({ getDatabase: vi.fn() }));
vi.mock("../platform/crypto", () => ({
  decryptSecret: vi.fn(),
  encryptSecret: vi.fn(),
}));
import { normalizeRecoveryCode } from "./two-factor";

describe("recovery codes", () => {
  it("match however they are typed from paper", () => {
    expect(normalizeRecoveryCode(" EGD67 AH8FB ")).toBe("egd67ah8fb");
    expect(normalizeRecoveryCode("egd67-ah8fb")).toBe("egd67ah8fb");
  });
});
