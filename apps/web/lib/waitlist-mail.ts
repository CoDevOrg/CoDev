import "server-only";

export async function sendWaitlistConfirmationEmail(to: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM ?? "CoDev <noreply@trycodev.com>";

  if (!apiKey) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`Waitlist confirmation for ${to} (RESEND_API_KEY not set).`);
    } else {
      console.error(
        "Waitlist confirmation email skipped: RESEND_API_KEY is not set.",
      );
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
      subject: "You're on the CoDev waitlist",
      text: [
        "Thanks for joining the CoDev waitlist.",
        "",
        "We're onboarding teams gradually. We'll email this address as soon as a spot opens up, along with some free tokens to get started.",
        "",
        "If you didn't request this, you can ignore this email.",
      ].join("\n"),
    }),
  });

  if (!response.ok) {
    console.error(
      "Waitlist confirmation email failed.",
      response.status,
      await response.text(),
    );
  }
}
