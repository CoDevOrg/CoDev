import "server-only";

/**
 * Sends a plain-text account email through Resend. Without an API key,
 * development logs the message instead; production logs that it was skipped.
 */
export async function sendAuthEmail(to: string, subject: string, text: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[auth-mail] To ${to}: ${subject}\n${text}`);
    } else {
      console.error(
        `Account email skipped (${subject}): RESEND_API_KEY is not set.`,
      );
    }
    return false;
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        from: process.env.AUTH_EMAIL_FROM ?? "CoDev <noreply@trycodev.com>",
        to,
        subject,
        text,
      }),
    });
    if (!response.ok) {
      console.error(`Account email failed (${subject}).`, response.status);
    }
    return response.ok;
  } catch (error) {
    console.error(`Account email failed (${subject}).`, error);
    return false;
  }
}
