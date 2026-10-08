"use client";

import { ChevronDown, KeyRound, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { ProviderAccount } from "@/components/settings/provider-account-actions";
import {
  ConnectSection,
  CopyableCommand,
} from "@/components/settings/provider-account-details";
import type {
  ClaudeCliTokenRecord,
  CliSubscriptionRecord,
  ProviderConnectionRecord,
} from "@/lib/providers/provider-connection-view";

/**
 * Every way into an account that is not its primary action, behind one
 * disclosure. Each way is a flat section inside it, so a member opens one
 * thing to see all of them rather than a disclosure inside a disclosure.
 */
export function ProviderConnectOptions({
  account,
  connection,
  subscription,
  claudeCliToken,
  anythingConnected,
  hostedConnect,
  onRevokeKey,
  onRevokeCli,
}: {
  account: ProviderAccount;
  connection: ProviderConnectionRecord;
  subscription: CliSubscriptionRecord;
  claudeCliToken: ClaudeCliTokenRecord | null;
  anythingConnected: boolean;
  hostedConnect: boolean;
  onRevokeKey: () => void;
  onRevokeCli: () => void;
}) {
  return (
    <details
      className="group rounded-md border border-border px-3"
      open={!anythingConnected && !hostedConnect}
    >
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {anythingConnected
          ? "Manage connection"
          : hostedConnect
            ? "Other ways to connect"
            : "Choose how to connect"}
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      {subscription.command ? (
        <>
          <Separator />
          <TerminalSection
            account={account}
            claudeCliToken={claudeCliToken}
            command={subscription.command}
            onRevoke={onRevokeCli}
            subscription={subscription}
          />
        </>
      ) : null}
      <Separator />
      <ApiKeySection
        account={account}
        connection={connection}
        onRevoke={onRevokeKey}
      />
    </details>
  );
}

function ApiKeySection({
  account,
  connection,
  onRevoke,
}: {
  account: ProviderAccount;
  connection: ProviderConnectionRecord;
  onRevoke: () => void;
}) {
  const saved = account.apiKeyState.status === "connected";
  const inputId = `api-key-${connection.provider}`;
  return (
    <ConnectSection
      connected={saved}
      description={`Bill usage to your own ${connection.label} account instead of a subscription.`}
      icon={KeyRound}
      title="Use an API key instead"
    >
      {saved ? (
        <p className="text-sm text-muted-foreground">
          A key ending {account.apiKeyState.lastFour} is saved.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={inputId}>
          {account.apiKeyLabel}
        </label>
        <Input
          autoComplete="off"
          className="min-w-[12rem] flex-1"
          disabled={account.disabled}
          id={inputId}
          onChange={(event) => account.setDraft(event.target.value)}
          placeholder={saved ? "Paste a new key" : "Paste API key"}
          spellCheck={false}
          type="password"
          value={account.draft}
        />
        <Button
          disabled={account.disabled || !account.draft.trim()}
          onClick={() => void account.save()}
          size="sm"
          type="button"
          variant="outline"
        >
          {account.busy === "save"
            ? "Saving…"
            : saved
              ? "Replace key"
              : "Save key"}
        </Button>
        {saved ? (
          <Button
            disabled={account.disabled}
            onClick={onRevoke}
            size="sm"
            type="button"
            variant="secondary"
          >
            {account.busy === "revoke" ? "Revoking…" : "Revoke"}
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Keys are encrypted on the CoDev server and never shown again after you
        save them.
      </p>
    </ConnectSection>
  );
}

function TerminalSection({
  account,
  subscription,
  claudeCliToken,
  command,
  onRevoke,
}: {
  account: ProviderAccount;
  subscription: CliSubscriptionRecord;
  claudeCliToken: ClaudeCliTokenRecord | null;
  command: string;
  onRevoke: () => void;
}) {
  const cliTokenConnected = claudeCliToken?.status === "connected";
  // Disconnect already removes this login along with the subscription, so a
  // second button for it only appears when there is nothing to disconnect.
  const showCliRevoke = cliTokenConnected && !account.connected;
  return (
    <ConnectSection
      connected={
        cliTokenConnected ||
        (account.connected && subscription.provenance === "cli")
      }
      description="Sign in from your own terminal with the CoDev CLI."
      icon={Terminal}
      title="Connect from a terminal"
    >
      {showCliRevoke ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Connected via codev claude-auth
            {claudeCliToken?.lastFour
              ? ` · ending ${claudeCliToken.lastFour}`
              : ""}
          </p>
          <Button
            disabled={account.disabled}
            onClick={onRevoke}
            size="sm"
            type="button"
            variant="outline"
          >
            {account.busy === "revoke" ? "Revoking…" : "Revoke"}
          </Button>
        </div>
      ) : null}
      <CopyableCommand command="npm install -g @trycodev/cli" />
      <CopyableCommand command="codev login" />
      <CopyableCommand command={command} />
    </ConnectSection>
  );
}
