import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ allow: vi.fn(), database: vi.fn() }));
vi.mock("./password-login-limit", () => ({ allowPasswordLogin: mocks.allow }));
vi.mock("../platform/database", () => ({ getDatabase: mocks.database }));

import {
  parseCredentialsFields,
  parseCredentialsIntent,
  resolveCredentialsAuthorizeStep,
  resolveCredentialsSignIn,
} from "./credentials-auth";

describe("credentials email auth", () => {
  it("throttles normalized accounts before any password lookup or hashing", async () => {
    mocks.allow.mockResolvedValue(false);
    expect(
      await resolveCredentialsSignIn({
        email: " Ada@Example.com ",
        password: "password",
      }),
    ).toBeNull();
    expect(mocks.allow).toHaveBeenCalledWith("ada@example.com");
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it("defaults unknown intents to sign-in", () => {
    expect(parseCredentialsIntent(undefined)).toBe("sign-in");
    expect(parseCredentialsIntent("sign-up")).toBe("sign-up");
  });

  it("normalizes email and name from the submitted fields", () => {
    expect(
      parseCredentialsFields({
        name: "  Ada  ",
        email: "Ada@Example.com ",
        password: "StrongPass1!",
        intent: "sign-up",
      }),
    ).toEqual({
      intent: "sign-up",
      name: "Ada",
      email: "ada@example.com",
      password: "StrongPass1!",
    });
  });

  it("lets an existing account sign in without a name", () => {
    expect(
      resolveCredentialsAuthorizeStep({
        intent: "sign-in",
        name: "",
        email: "ada@example.com",
        password: "whatever-they-already-use",
        existingUser: true,
      }),
    ).toBe("verify-existing");
  });

  it("does not create an account from the sign-in form", () => {
    expect(
      resolveCredentialsAuthorizeStep({
        intent: "sign-in",
        name: "Ada",
        email: "ada@example.com",
        password: "StrongPass1!",
        existingUser: false,
      }),
    ).toBe("reject");
  });

  it("creates an account only from the sign-up form with a name and strong password", () => {
    expect(
      resolveCredentialsAuthorizeStep({
        intent: "sign-up",
        name: "Ada",
        email: "ada@example.com",
        password: "StrongPass1!",
        existingUser: false,
      }),
    ).toBe("create-account");
    expect(
      resolveCredentialsAuthorizeStep({
        intent: "sign-up",
        name: "",
        email: "ada@example.com",
        password: "StrongPass1!",
        existingUser: false,
      }),
    ).toBe("reject");
  });
});
