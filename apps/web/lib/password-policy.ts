export const NEW_ACCOUNT_PASSWORD_MIN_LENGTH = 10;

// Keep this deliberately small and actionable. A larger compromised-password
// service can replace it without changing the account-creation contract.
const COMMON_PASSWORDS = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "abcdefgh",
  "letmein",
  "password",
  "password1",
  "password123",
  "qwerty",
  "qwerty123",
  "welcome",
]);

export type PasswordRequirement = Readonly<{
  id: "length" | "uppercase" | "lowercase" | "number" | "symbol" | "uncommon";
  label: string;
  met: boolean;
}>;

/**
 * These requirements apply when an email address creates a new CoDev account.
 * Existing local accounts can still sign in with their established password.
 */
export function getNewAccountPasswordRequirements(
  password: string,
): PasswordRequirement[] {
  return [
    {
      id: "length",
      label: `At least ${NEW_ACCOUNT_PASSWORD_MIN_LENGTH} characters`,
      met: password.length >= NEW_ACCOUNT_PASSWORD_MIN_LENGTH,
    },
    {
      id: "uppercase",
      label: "One uppercase letter",
      met: /[A-Z]/.test(password),
    },
    {
      id: "lowercase",
      label: "One lowercase letter",
      met: /[a-z]/.test(password),
    },
    {
      id: "number",
      label: "One number",
      met: /\d/.test(password),
    },
    {
      id: "symbol",
      label: "One special character",
      met: /[^A-Za-z0-9]/.test(password),
    },
    {
      id: "uncommon",
      label: "Not a common password",
      met: !COMMON_PASSWORDS.has(password.toLowerCase()),
    },
  ];
}

export function getNewAccountPasswordError(password: string) {
  return (
    getNewAccountPasswordRequirements(password).find(
      (requirement) => !requirement.met,
    )?.label ?? null
  );
}
