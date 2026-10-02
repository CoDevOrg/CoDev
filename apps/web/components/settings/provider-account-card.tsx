"use client";

import type { ReactNode } from "react";
import { KeyRound, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ClaudeHostedConnect } from "@/components/settings/claude-hosted-connect";
import { CodexHostedConnect } from "@/components/settings/codex-hosted-connect";
import { useProviderAccountCard } from "@/components/settings/provider-account-actions";
import {
  CopyableCommand,
  FallbackRow,
  RunsIn,
  SurfaceToggle,
} from "@/components/settings/provider-account-details";
import type {
  ClaudeCliTokenRecord,
  CliSubscriptionRecord,
  ProviderConnectionRecord,
} from "@/lib/providers/provider-connection-view";
import type { ExecutorSurface } from "@/lib/providers/registry";

export function ProviderAccountCard({
  logo,
  label,
  subscription,
  connection,
  hostedClaudeConnect = false,
  hostedOpenAIConnect = false,
  runsIn,
  claudeCliToken,
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
  /** Claude's `codev claude-auth` setup-token. */
  claudeCliToken?: ClaudeCliTokenRecord;
}) {
  const account = useProviderAccountCard({ connection, label, subscription });
  const showClaudeConnect =
    hostedClaudeConnect && subscription.provider === "claude";
  const showCodexConnect =
    hostedOpenAIConnect && subscription.provider === "codex";
  const showHostedConnect = showClaudeConnect || showCodexConnect;
  const cliTokenConnected = claudeCliToken?.status === "connected";
  const runsInSharedWorkspace = runsIn.includes("gen2");
  const anythingConnected =
    account.connected ||
    cliTokenConnected ||
    account.apiKeyState.status === "connected";

  return (
    <Card className="flex flex-col gap-3 p-4">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
            {logo}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle>{label}</CardTitle>
            <RunsIn connected={anythingConnected} surfaces={runsIn} />
          </div>
        </div>
        {account.connected ? (
          <Button
            disabled={account.disabled}
            onClick={() => void account.disconnect()}
            size="sm"
            type="button"
            variant="outline"
          >
            {account.busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
          </Button>
        ) : null}
      </CardHeader>
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
        <div className="flex flex-col gap-3">
          <FallbackRow
            connected={account.apiKeyState.status === "connected"}
            defaultOpen={!anythingConnected && !showHostedConnect}
            description={`Bill usage to your own ${connection.label} account instead of a subscription.`}
            icon={KeyRound}
            title="Use an API key instead"
          >
            {account.apiKeyState.status === "connected" ? (
              <p className="text-sm text-muted-foreground">
                Saved by {account.apiKeyState.suppliedBy} · ending{" "}
                {account.apiKeyState.lastFour}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <label
                className="sr-only"
                htmlFor={`api-key-${connection.provider}`}
              >
                {account.apiKeyLabel}
              </label>
              <Input
                autoComplete="off"
                className="min-w-[12rem] flex-1"
                disabled={account.disabled}
                id={`api-key-${connection.provider}`}
                onChange={(event) => account.setDraft(event.target.value)}
                placeholder="Paste API key"
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
                  : account.apiKeyState.status === "connected"
                    ? "Replace key"
                    : "Save key"}
              </Button>
              {account.apiKeyState.status === "connected" ? (
                <Button
                  disabled={account.disabled}
                  onClick={() => void account.revoke()}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  {account.busy === "revoke" ? "Revoking…" : "Revoke"}
                </Button>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              Keys are encrypted on the CoDev server and never shown again after
              you save them.
            </p>
          </FallbackRow>
          {subscription.command ? (
            <FallbackRow
              connected={
                cliTokenConnected ||
                (account.connected && subscription.provenance === "cli")
              }
              defaultOpen={!anythingConnected && !showHostedConnect}
              description="Sign in from your own terminal with the CoDev CLI."
              icon={Terminal}
              title="Connect from a terminal"
            >
              {subscription.provider === "claude" && cliTokenConnected ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    Connected via codev claude-auth
                    {claudeCliToken?.lastFour
                      ? ` · ending ${claudeCliToken.lastFour}`
                      : ""}
                  </p>
                  <Button
                    disabled={account.disabled}
                    onClick={() => void account.revokeClaudeCliToken()}
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
              <CopyableCommand command={subscription.command} />
            </FallbackRow>
          ) : null}
          {runsInSharedWorkspace ? (
            <SurfaceToggle
              checked={subscription.allowInSharedWorkspaces}
              disabled={account.disabled}
              label="Allow in shared workspaces"
              note="Turns you start in a workspace other people can see run on this login, and are billed to you."
              onChange={(next) =>
                void account.setSharedWorkspaceUse("subscription", next)
              }
            />
          ) : null}
        </div>
        {account.message ? (
          <p className="text-sm text-muted-foreground" role="status">
            {account.message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
