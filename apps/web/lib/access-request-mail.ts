import "server-only";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function sender() {
  return process.env.AUTH_EMAIL_FROM ?? "CoDev <noreply@trycodev.com>";
}

async function send(payload: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`Access-request email for ${payload.to}: ${payload.subject}`);
    } else {
      console.error("Access-request email skipped: RESEND_API_KEY is not set.");
    }
    return;
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: sender(),
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
    }),
  });

  if (!response.ok) {
    console.error(
      "Access-request email failed.",
      response.status,
      await response.text(),
    );
  }
}

/** Confirms to the requester that their private-beta request landed. */
export async function sendAccessRequestReceipt(request: {
  email: string;
  name: string;
}) {
  const firstName = request.name.split(/\s+/)[0] ?? request.name;
  await send({
    to: request.email,
    subject: "We got your CoDev access request",
    text: [
      `Hi ${firstName},`,
      "",
      "Thanks for asking for access to CoDev. Your request is in — we're letting builders in a group at a time while the private beta is still small.",
      "",
      "When your invite is ready we'll email this address with a link that gets you straight into a workspace.",
      "",
      "— The CoDev team",
    ].join("\n"),
  });
}

/**
 * Optional internal ping so a new request is visible without watching the
 * table. Silently does nothing when the notify address is unset.
 */
export async function notifyTeamOfAccessRequest(request: {
  email: string;
  name: string;
  githubLogin?: string | undefined;
  persona?: string | undefined;
  building?: string | undefined;
}) {
  const to = process.env.ACCESS_REQUEST_NOTIFY_EMAIL;
  if (!to) return;

  await send({
    to,
    replyTo: request.email,
    subject: `CoDev access request: ${request.name}`,
    text: [
      `Name: ${request.name}`,
      `Email: ${request.email}`,
      `GitHub: ${request.githubLogin ?? "—"}`,
      `Building with: ${request.persona ?? "—"}`,
      "",
      request.building ?? "(no description)",
    ].join("\n"),
  });
}
