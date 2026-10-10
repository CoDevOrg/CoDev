import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import type { listSecurityEvents } from "@/lib/auth/security-events";
import { describeUserAgent } from "@/lib/auth/user-agent";

import { SettingsTime } from "./settings-time";

const LABELS: Record<string, string> = {
  sign_in: "Signed in",
  password_changed: "Password changed",
  password_reset: "Password set from an emailed link",
  password_link_sent: "Password link emailed",
  two_factor_enabled: "Two-factor authentication turned on",
  two_factor_disabled: "Two-factor authentication turned off",
  recovery_codes_regenerated: "New recovery codes generated",
  recovery_code_used: "Recovery code used to sign in",
  session_revoked: "A session was signed out",
  other_sessions_revoked: "All other sessions signed out",
  cli_token_revoked: "A CLI or app login was revoked",
};

type SecurityEvent = Awaited<ReturnType<typeof listSecurityEvents>>[number];

export function SecurityActivity({ events }: { events: SecurityEvent[] }) {
  if (events.length === 0)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No activity yet</EmptyTitle>
          <EmptyDescription>
            Sign-ins and security changes will appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );

  return (
    <ul className="flex flex-col divide-y divide-border">
      {events.map((event) => (
        <li
          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 first:pt-0 last:pb-0"
          key={event.id}
        >
          <span className="text-sm">{LABELS[event.type] ?? event.type}</span>
          <span className="text-xs text-muted-foreground">
            {describeUserAgent(event.userAgent).label}
            {event.ipAddress ? ` · ${event.ipAddress}` : ""} ·{" "}
            <SettingsTime date={event.createdAt} />
          </span>
        </li>
      ))}
    </ul>
  );
}
