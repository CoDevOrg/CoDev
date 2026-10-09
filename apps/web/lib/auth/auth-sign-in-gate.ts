/**
 * Decides which branch of the Auth.js `signIn` callback should run.
 * Credentials must be allowed here — `authorize()` already validated them.
 */
export function resolveSignInProviderGate(
  provider: string | undefined,
): "allow-credentials" | "handle-google" | "handle-github" | "deny" {
  if (provider === "credentials" || provider === "admin-handoff")
    return "allow-credentials";
  if (provider === "google") return "handle-google";
  if (provider === "github") return "handle-github";
  return "deny";
}
