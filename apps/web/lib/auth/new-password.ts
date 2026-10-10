import "server-only";

import { isBreachedPassword } from "./breached-password";
import {
  getNewAccountPasswordError,
  PASSWORD_MAX_LENGTH,
} from "./password-policy";

export type NewPasswordProblem = "match" | "policy" | "too_long" | "breached";

/** Every rule a new password must pass, shared by change, set, and reset. */
export async function newPasswordProblem(
  password: string,
  confirm: string,
): Promise<NewPasswordProblem | null> {
  if (password !== confirm) return "match";
  if (password.length > PASSWORD_MAX_LENGTH) return "too_long";
  if (getNewAccountPasswordError(password)) return "policy";
  if (await isBreachedPassword(password)) return "breached";
  return null;
}

export const NEW_PASSWORD_MESSAGES: Record<NewPasswordProblem, string> = {
  match: "Those passwords did not match. Try again.",
  policy: "Choose a stronger password that meets every requirement.",
  too_long: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
  breached:
    "That password has appeared in a known data breach. Choose one you have not used elsewhere.",
};
