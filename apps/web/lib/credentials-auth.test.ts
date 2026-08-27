import { describe, expect, it } from "vitest";

import {
  parseCredentialsFields,
  parseCredentialsIntent,
  resolveCredentialsAuthorizeStep,
} from "./credentials-auth";

describe("credentials email auth", () => {
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
        waitlistModeEnabled: false,
      }),
    ).toBe("verify-existing");
  });

  it("lets an existing account sign in even while waitlist mode is on", () => {
    expect(
      resolveCredentialsAuthorizeStep({
        intent: "sign-in",
        name: "",
        email: "ada@example.com",
        password: "whatever-they-already-use",
        existingUser: true,
        waitlistModeEnabled: true,
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
        waitlistModeEnabled: false,
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
        waitlistModeEnabled: false,
      }),
    ).toBe("create-account");
    expect(
      resolveCredentialsAuthorizeStep({
        intent: "sign-up",
        name: "",
        email: "ada@example.com",
        password: "StrongPass1!",
        existingUser: false,
        waitlistModeEnabled: false,
      }),
    ).toBe("reject");
  });

  it("blocks new account creation while waitlist mode is on, even with a valid sign-up", () => {
    expect(
      resolveCredentialsAuthorizeStep({
        intent: "sign-up",
        name: "Ada",
        email: "ada@example.com",
        password: "StrongPass1!",
        existingUser: false,
        waitlistModeEnabled: true,
      }),
    ).toBe("reject");
  });
});
