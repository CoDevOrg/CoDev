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
      console.info(
        `Access-request email for ${payload.to}: ${payload.subject}`,
      );
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
  name?: string | undefined;
}) {
  await send({
    to: request.email,
    subject: "We got your CoDev access request",
    text: [
      "Thanks for joining the Codev waitlist.",
      "",
      "We’re building Codev to make coding with AI feel multiplayer. Bring in your existing chats, work in shared coding workspaces, and let teammates jump into the same sessions and collaborate with you and your agents in real time.",
      "",
      "We’ll be opening up access soon.",
      "",
      "The Codev Team",
    ].join("\n"),
  });
}

/** Tells an approved requester they're in, with the single-use accept link. */
export async function sendAccessRequestInvite(invite: {
  email: string;
  name?: string | null | undefined;
  acceptUrl: string;
}) {
  const firstName = invite.name?.split(/\s+/)[0];
  await send({
    to: invite.email,
    subject: "Your CoDev invite is ready",
    text: [
      firstName ? `Hi ${firstName},` : "Hi,",
      "",
      "You're in. Use the link below to create your CoDev account — it works once and expires in 14 days:",
      "",
      invite.acceptUrl,
      "",
      "Open it on the device you want to build from. You can sign up with Google, GitHub, or an email and password.",
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
  name?: string | undefined;
  persona?: string | undefined;
  building?: string | undefined;
}) {
  const to = process.env.ACCESS_REQUEST_NOTIFY_EMAIL;
  if (!to) return;

  await send({
    to,
    replyTo: request.email,
    subject: `CoDev access request: ${request.name || request.email}`,
    text: [
      `Name: ${request.name || "(not given)"}`,
      `Email: ${request.email}`,
      `Building with: ${request.persona ?? "—"}`,
      "",
      request.building ?? "(no description)",
    ].join("\n"),
  });
}
