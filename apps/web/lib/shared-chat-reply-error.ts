import "server-only";

import { APICallError } from "ai";
import { ClaudeConnectionError } from "./claude-connection";

export const ROOM_REPLY_FAILURE =
  "The reply could not be completed. Please try again shortly.";

/** Only curated text and numeric status may leave the provider error boundary. */
export function classifyRoomReplyError(error: unknown) {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    if (status === 429)
      return {
        category: "provider_rate_limit",
        status,
        message:
          "Your AI provider rejected this request with HTTP 429. This does not confirm that your subscription allowance is exhausted. If your usage is available, the connection or execution path needs investigation.",
      };
    if (status === 401 || status === 403)
      return {
        category: "provider_authentication",
        status,
        message:
          "Your AI provider rejected this connection. Check your subscription in Settings and reconnect if needed.",
      };
    return { category: "provider_error", status, message: ROOM_REPLY_FAILURE };
  }
  if (error instanceof ClaudeConnectionError && error.status === 429)
    return {
      category: "subscription_busy",
      status: 429,
      message:
        "Your subscription is already running another reply. Wait for it to finish, then try again.",
    };
  return { category: "execution_error", message: ROOM_REPLY_FAILURE };
}
