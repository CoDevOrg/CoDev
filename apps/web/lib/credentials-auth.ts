import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { hashPassword, verifyPassword } from "./crypto";
import { getDatabase } from "./database";
import { getNewAccountPasswordError } from "./password-policy";

export type CredentialsIntent = "sign-in" | "sign-up";

export type CredentialsAuthorizeStep =
  | "reject"
  | "verify-existing"
  | "create-account";

export function parseCredentialsIntent(value: unknown): CredentialsIntent {
  return value === "sign-up" ? "sign-up" : "sign-in";
}

export function parseCredentialsFields(credentials: {
  name?: unknown;
  email?: unknown;
  password?: unknown;
  intent?: unknown;
}) {
  return {
    intent: parseCredentialsIntent(credentials.intent),
    name: typeof credentials.name === "string" ? credentials.name.trim() : "",
    email:
      typeof credentials.email === "string"
        ? credentials.email.trim().toLowerCase()
        : "",
    password:
      typeof credentials.password === "string" ? credentials.password : "",
  };
}

export function resolveCredentialsAuthorizeStep(input: {
  intent: CredentialsIntent;
  name: string;
  email: string;
  password: string;
  existingUser: boolean;
}): CredentialsAuthorizeStep {
  if (!input.email || !input.password) return "reject";
  if (input.existingUser) return "verify-existing";
  if (
    input.intent === "sign-up" &&
    input.name &&
    !getNewAccountPasswordError(input.password)
  ) {
    return "create-account";
  }
  return "reject";
}

export type CredentialsUser = {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

export type CredentialsSignInHooks = {
  /**
   * Called with the normalized email just before a NEW account would be
   * created. Return `false` (or throw) to block registration. Existing-user
   * sign-in never invokes this.
   */
  guardRegistration?: (email: string) => Promise<boolean> | boolean;
  /** Called after a new account is successfully created. */
  onRegistered?: (user: CredentialsUser) => Promise<void> | void;
};

/**
 * Shared by NextAuth's Credentials `authorize()` (web) and the mobile
 * email sign-in route — the only two entry points for password-based
 * login, so identity/lookup/creation logic lives here once.
 */
export async function resolveCredentialsSignIn(
  credentials: {
    intent?: unknown;
    name?: unknown;
    email?: unknown;
    password?: unknown;
  },
  hooks: CredentialsSignInHooks = {},
): Promise<CredentialsUser | null> {
  const { intent, name, email, password } = parseCredentialsFields(credentials);
  if (!email || !password) return null;

  const database = getDatabase();
  const [existingUser] = await database
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      avatarUrl: schema.users.avatarUrl,
      passwordHash: schema.users.passwordHash,
    })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  const step = resolveCredentialsAuthorizeStep({
    intent,
    name,
    email,
    password,
    existingUser: Boolean(existingUser),
  });

  if (step === "reject") return null;

  if (step === "create-account" && hooks.guardRegistration) {
    let permitted = false;
    try {
      permitted = await hooks.guardRegistration(email);
    } catch {
      permitted = false;
    }
    if (!permitted) return null;
  }

  if (step === "verify-existing") {
    if (
      !existingUser?.passwordHash ||
      !(await verifyPassword(password, existingUser.passwordHash))
    ) {
      return null;
    }
    return {
      id: existingUser.id,
      name: existingUser.name,
      email: existingUser.email,
      avatarUrl: existingUser.avatarUrl,
    };
  }

  const [localUser] = await database
    .insert(schema.users)
    .values({
      login: `local-${randomBytes(8).toString("hex")}`,
      name,
      email,
      passwordHash: await hashPassword(password),
    })
    .returning({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      avatarUrl: schema.users.avatarUrl,
    });

  if (!localUser) return null;

  const created: CredentialsUser = {
    id: localUser.id,
    name: localUser.name,
    email: localUser.email,
    avatarUrl: localUser.avatarUrl,
  };
  await hooks.onRegistered?.(created);
  return created;
}
