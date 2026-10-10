import { Monitor, Smartphone } from "lucide-react";

import {
  signOutOtherSessionsAction,
  signOutSessionAction,
} from "@/app/actions/sessions";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { describeUserAgent } from "@/lib/auth/user-agent";
import type { listUserSessions } from "@/lib/auth/user-sessions";

import { SessionActionButton } from "./session-action-button";
import { SettingsTime } from "./settings-time";

const METHOD_LABELS: Record<string, string> = {
  password: "Signed in with password",
  google: "Signed in with Google",
  github: "Signed in with GitHub",
  "admin-handoff": "Opened from the main site",
  session: "Signed in",
};

type Session = Awaited<ReturnType<typeof listUserSessions>>[number];

export function BrowserSessionList({
  sessions,
  currentSessionId,
}: {
  sessions: Session[];
  currentSessionId: string | undefined;
}) {
  const others = sessions.filter((session) => session.id !== currentSessionId);
  // The current browser first; a pre-tracking cookie has no row to show.
  const ordered = [
    ...sessions.filter((session) => session.id === currentSessionId),
    ...others,
  ];

  return (
    <div className="flex flex-col gap-3">
      {!currentSessionId ? (
        <p className="m-0 text-sm text-muted-foreground">
          This browser signed in before session tracking, so it is not listed.
          Signing out other sessions moves it onto the list.
        </p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {ordered.map((session, index) => {
          const device = describeUserAgent(session.userAgent);
          const Icon = device.mobile ? Smartphone : Monitor;
          const current = session.id === currentSessionId;
          return (
            <li className="flex flex-col gap-3" key={session.id}>
              {index > 0 ? <Separator /> : null}
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Icon aria-hidden className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="m-0 flex flex-wrap items-center gap-2 text-sm font-medium">
                      {device.label}
                      {current ? (
                        <Badge variant="secondary">This browser</Badge>
                      ) : null}
                    </p>
                    <p className="m-0 truncate text-xs text-muted-foreground">
                      {METHOD_LABELS[session.signInMethod] ?? "Signed in"}
                      {session.ipAddress ? ` · ${session.ipAddress}` : ""}
                      {" · "}
                      {current ? (
                        "Active now"
                      ) : (
                        <>
                          Active <SettingsTime date={session.lastSeenAt} />
                        </>
                      )}
                    </p>
                  </div>
                </div>
                {current ? null : (
                  <SessionActionButton
                    label="Sign out"
                    pendingLabel="Signing out…"
                    run={signOutSessionAction.bind(null, session.id)}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {others.length > 0 || !currentSessionId ? (
        <div>
          <SessionActionButton
            label="Sign out all other sessions"
            pendingLabel="Signing out…"
            run={signOutOtherSessionsAction}
            variant="destructive"
          />
        </div>
      ) : (
        <p className="m-0 text-sm text-muted-foreground">
          You are not signed in anywhere else.
        </p>
      )}
    </div>
  );
}
