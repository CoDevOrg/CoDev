export const NEW_ACCOUNT_PASSWORD_MIN_LENGTH = 15;

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

export function getNewAccountPasswordError(password: string) {
  if (COMMON_PASSWORDS.has(password.toLocaleLowerCase())) {
    return "Choose a less common password or passphrase.";
  }

  if (password.length < NEW_ACCOUNT_PASSWORD_MIN_LENGTH) {
    return `Use at least ${NEW_ACCOUNT_PASSWORD_MIN_LENGTH} characters for a new account.`;
  }

  return null;
}
