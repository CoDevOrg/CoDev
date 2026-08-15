import "server-only";

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM ?? "CoDev <noreply@trycodev.com>";

  if (!apiKey) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`Password reset URL for ${to}: ${resetUrl}`);
    } else {
      console.error("Password reset email skipped: RESEND_API_KEY is not set.");
    }
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: "Reset your CoDev password",
      text: [
        "Reset your CoDev password with this link:",
        "",
        resetUrl,
        "",
        "This link expires in one hour. If you did not ask to reset your password, you can ignore this email.",
      ].join("\n"),
    }),
  });

  if (!response.ok) {
    console.error(
      "Password reset email failed.",
      response.status,
      await response.text(),
    );
  }
}
