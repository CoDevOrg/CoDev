import "server-only";

import { sendAuthEmail } from "./auth-mail";

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
  hasPassword = true,
) {
  await sendAuthEmail(
    to,
    hasPassword ? "Reset your CoDev password" : "Create a CoDev password",
    [
      hasPassword
        ? "Reset your CoDev password with this link:"
        : "Your CoDev account signs in with Google or GitHub. Create a password with this link to also sign in with your email:",
      "",
      resetUrl,
      "",
      "This link expires in one hour and stops working once used. Using it signs you out everywhere else. If you did not ask for this, ignore this email; your account is unchanged.",
    ].join("\n"),
  );
}
