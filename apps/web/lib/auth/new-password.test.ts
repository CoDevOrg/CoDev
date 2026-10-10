import { describe, expect, it, vi } from "vitest";

const breached = vi.hoisted(() => vi.fn(async () => false));
vi.mock("./breached-password", () => ({ isBreachedPassword: breached }));
import { newPasswordProblem } from "./new-password";

describe("newPasswordProblem", () => {
  const strong = "Correct-Horse-9-Battery";

  it("accepts a strong, unbreached password", async () => {
    expect(await newPasswordProblem(strong, strong)).toBeNull();
  });

  it("checks match, length, policy, then the breach corpus", async () => {
    expect(await newPasswordProblem(strong, `${strong}x`)).toBe("match");
    const long = `Aa1!${"x".repeat(130)}`;
    expect(await newPasswordProblem(long, long)).toBe("too_long");
    expect(await newPasswordProblem("short", "short")).toBe("policy");
    breached.mockResolvedValueOnce(true);
    expect(await newPasswordProblem(strong, strong)).toBe("breached");
  });
});
