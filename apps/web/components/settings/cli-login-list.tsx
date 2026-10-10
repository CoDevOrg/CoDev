import { Smartphone, SquareTerminal } from "lucide-react";

import { revokeCliTokenAction } from "@/app/actions/sessions";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import type { listCliAccessTokens } from "@/lib/auth/cli-access-tokens";

import { SessionActionButton } from "./session-action-button";
import { SettingsTime } from "./settings-time";

type CliLogin = Awaited<ReturnType<typeof listCliAccessTokens>>[number];

export function CliLoginList({ logins }: { logins: CliLogin[] }) {
  if (logins.length === 0)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No CLI or app logins</EmptyTitle>
          <EmptyDescription>
            Run <code>codev login</code> or sign in to the mobile app to see it
            here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );

  return (
    <ul className="flex flex-col gap-3">
      {logins.map((login, index) => {
        const Icon =
          login.clientType === "mobile" ? Smartphone : SquareTerminal;
        return (
          <li className="flex flex-col gap-3" key={login.id}>
            {index > 0 ? <Separator /> : null}
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Icon aria-hidden className="size-4" />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="m-0 truncate text-sm font-medium">
                    {login.name}
                  </p>
                  <p className="m-0 truncate text-xs text-muted-foreground">
                    Created <SettingsTime date={login.createdAt} />
                    {" · "}
                    {login.lastUsedAt ? (
                      <>
                        Last used <SettingsTime date={login.lastUsedAt} />
                      </>
                    ) : (
                      "Never used"
                    )}
                    {" · "}Expires <SettingsTime date={login.expiresAt} />
                  </p>
                </div>
              </div>
              <SessionActionButton
                label="Revoke"
                pendingLabel="Revoking…"
                run={revokeCliTokenAction.bind(null, login.id)}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
