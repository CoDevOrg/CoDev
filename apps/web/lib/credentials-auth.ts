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
