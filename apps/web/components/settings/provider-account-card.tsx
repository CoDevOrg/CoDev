"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { ClaudeHostedConnect } from "@/components/settings/claude-hosted-connect";
import { CodexHostedConnect } from "@/components/settings/codex-hosted-connect";
import {
  useProviderAccountCard,
  type ProviderAccount,
} from "@/components/settings/provider-account-actions";
import {
  ConnectionBadge,
  RunsIn,
} from "@/components/settings/provider-account-details";
import { ProviderConnectOptions } from "@/components/settings/provider-connect-options";
import type {
  ClaudeCliTokenRecord,
  CliSubscriptionRecord,
  ProviderConnectionRecord,
} from "@/lib/providers/provider-connection-view";
import type { ExecutorSurface } from "@/lib/providers/registry";

type Confirming = "disconnect" | "revoke-key" | "revoke-cli" | null;

const SIGNED_IN_FROM = {
  cli: "Subscription, signed in from the CLI",
  browser: "Subscription, signed in with the browser",
} as const;

export function ProviderAccountCard({
  logo,
  label,
  subscription,
  connection,
  hostedClaudeConnect = false,
  hostedOpenAIConnect = false,
  runsIn,
  claudeCliToken,
  onChange,
  dialogClassName,
}: {
  logo: ReactNode;
  label: string;
  subscription: CliSubscriptionRecord;
  connection: ProviderConnectionRecord;
  /** Show the in-app "Connect Claude" flow (anthropic card only). */
  hostedClaudeConnect?: boolean;
  /** Show the in-app "Connect ChatGPT" device-code flow (openai card only). */
  hostedOpenAIConnect?: boolean;
  /**
   * Where this provider can run right now, derived from the registry by
   * `providerRunsIn`. The card states it rather than deducing it.
   */
  runsIn: ExecutorSurface[];
  /** Claude's `codev claude-auth` setup-token; ignored on other cards. */
  claudeCliToken?: ClaudeCliTokenRecord | undefined;
  /** Reload the connections after a change; see `useProviderAccountCard`. */
  onChange?: (() => void) | undefined;
  /** Surface class for confirmations, which portal outside the card. */
  dialogClassName?: string | undefined;
}) {
  const account = useProviderAccountCard({
    connection,
    label,
    subscription,
    onChange,
  });
  const [confirming, setConfirming] = useState<Confirming>(null);
  const isClaude = subscription.provider === "claude";
  const showClaudeConnect = hostedClaudeConnect && isClaude;
  const showCodexConnect =
    hostedOpenAIConnect && subscription.provider === "codex";
  // Only Claude has a CLI token; another card must not read Claude's.
  const cliToken = isClaude ? (claudeCliToken ?? null) : null;
  const apiKeyConnected = account.apiKeyState.status === "connected";
  const anythingConnected =
    account.connected || cliToken?.status === "connected" || apiKeyConnected;
  const summary = [
    account.connected
      ? subscription.provenance
        ? SIGNED_IN_FROM[subscription.provenance]
        : "Subscription"
      : cliToken?.status === "connected"
        ? SIGNED_IN_FROM.cli
        : null,
    apiKeyConnected ? `API key ending ${account.apiKeyState.lastFour}` : null,
  ].filter((part): part is string => part !== null);

  return (
    // Neither settings nor the workspace loads Tailwind's element reset, so
    // browser paragraph and heading margins would stack on top of the gaps,
    // and the global `button { font: inherit }` makes controls take the
    // card's size rather than their own `text-sm`.
    <Card className="flex flex-col gap-4 p-4 text-sm [&_:is(p,h3,h4)]:m-0">
      <AccountHeader
        busy={account.busy === "disconnect"}
        connected={anythingConnected}
        disabled={account.disabled}
        label={label}
        logo={logo}
        onDisconnect={
          account.connected ? () => setConfirming("disconnect") : null
        }
        runsIn={runsIn}
        summary={summary}
      />
      <CardContent className="flex flex-col gap-3">
        {showClaudeConnect ? (
          <ClaudeHostedConnect
            connected={account.connected}
            onConnected={account.finishConnected}
          />
        ) : null}
        {showCodexConnect ? (
          <CodexHostedConnect
            connected={account.connected}
            onConnected={account.finishConnected}
          />
        ) : null}
        <ProviderConnectOptions
          account={account}
          anythingConnected={anythingConnected}
          claudeCliToken={cliToken}
          connection={connection}
          hostedConnect={showClaudeConnect || showCodexConnect}
          onRevokeCli={() => setConfirming("revoke-cli")}
          onRevokeKey={() => setConfirming("revoke-key")}
          subscription={subscription}
        />
        {account.inlineMessage ? (
          <Alert
            role={account.inlineMessage.tone === "error" ? "alert" : "status"}
            variant={
              account.inlineMessage.tone === "error" ? "destructive" : "default"
            }
          >
            <AlertDescription>{account.inlineMessage.text}</AlertDescription>
          </Alert>
        ) : null}
        <AccountConfirmation
          account={account}
          className={dialogClassName}
          confirming={confirming}
          label={label}
          onClose={() => setConfirming(null)}
        />
      </CardContent>
    </Card>
  );
}

function AccountHeader({
  logo,
  label,
  connected,
  summary,
  runsIn,
  busy,
  disabled,
  onDisconnect,
}: {
  logo: ReactNode;
  label: string;
  connected: boolean;
  summary: string[];
  runsIn: ExecutorSurface[];
  busy: boolean;
  disabled: boolean;
  /** Null when there is no subscription login to disconnect. */
  onDisconnect: (() => void) | null;
}) {
  return (
    <CardHeader className="flex-row flex-wrap items-start gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
        {logo}
      </span>
      <div className="flex min-w-40 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{label}</CardTitle>
          <ConnectionBadge connected={connected} />
        </div>
        {summary.length > 0 ? (
          <p className="text-sm text-muted-foreground">{summary.join(" · ")}</p>
        ) : null}
        <RunsIn connected={connected} surfaces={runsIn} />
      </div>
      {onDisconnect ? (
        <Button
          className="ml-auto"
          disabled={disabled}
          onClick={onDisconnect}
          size="sm"
          type="button"
          variant="outline"
        >
          {busy ? "Disconnecting…" : "Disconnect"}
        </Button>
      ) : null}
    </CardHeader>
  );
}

const CONFIRMATIONS = {
  disconnect: (label: string) => ({
    title: `Disconnect ${label}?`,
    confirmLabel: `Disconnect ${label}`,
    body: `Agents stop running on this ${label} login until you connect it again. Any API key you saved stays in place.`,
    run: (account: ProviderAccount) => account.disconnect(),
  }),
  "revoke-key": (label: string) => ({
    title: `Revoke the ${label} API key?`,
    confirmLabel: "Revoke key",
    body: "The saved key is deleted from CoDev. You will need to paste it again to use it.",
    run: (account: ProviderAccount) => account.revoke(),
  }),
  "revoke-cli": (label: string) => ({
    title: `Revoke the ${label} CLI login?`,
    confirmLabel: "Revoke login",
    body: "Run the CLI command again to reconnect.",
    run: (account: ProviderAccount) => account.revokeClaudeCliToken(),
  }),
} as const;

function AccountConfirmation({
  account,
  confirming,
  label,
  className,
  onClose,
}: {
  account: ProviderAccount;
  confirming: Confirming;
  label: string;
  className: string | undefined;
  onClose: () => void;
}) {
  if (!confirming) return null;
  const confirmation = CONFIRMATIONS[confirming](label);
  return (
    <ConfirmDialog
      busy={account.disabled}
      className={className}
      confirmLabel={confirmation.confirmLabel}
      onCancel={onClose}
      onConfirm={() => {
        onClose();
        void confirmation.run(account);
      }}
      title={confirmation.title}
    >
      {confirmation.body}
    </ConfirmDialog>
  );
}
