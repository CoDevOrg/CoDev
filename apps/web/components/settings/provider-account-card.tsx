"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { Check, ChevronDown, Copy, KeyRound, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { useSettingsNotify } from "@/components/settings/settings-feedback";
import { Input } from "@/components/ui/input";
import { ClaudeHostedConnect } from "@/components/settings/claude-hosted-connect";
import { CodexHostedConnect } from "@/components/settings/codex-hosted-connect";
import type {
  ClaudeCliTokenRecord,
  CliSubscriptionRecord,
  ProviderConnectionProvider,
  ProviderConnectionRecord,
} from "@/lib/providers/provider-connection-view";
import { SURFACE_LABEL } from "@/lib/providers/provider-surface-capability";
import type { ExecutorSurface } from "@/lib/providers/registry";
import { cn } from "@/lib/platform/utils";

const RETURN_TO = "/settings/personal/providers";

/**
 * The in-page sign-in state for a provider with a browser OAuth flow. Only
 * Cursor still has one — Claude and Codex connect via an API key or the
 * CoDev CLI (which itself delegates to each provider's own official CLI
 * login), since Anthropic and OpenAI both restrict consumer-plan OAuth
 * tokens obtained outside their own first-party clients.
 */
type ActiveFlow = { kind: "polling"; loginUrl: string };

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs">
      <span>
        <span className="text-emerald-400">$</span> {command}
      </span>
      <button
        aria-label="Copy command"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => {
          void navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        type="button"
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
    </div>
  );
}

/**
 * "Also use in <the other surface>". Rendered only where the method actually
 * allows the flip; an impossible case (a browser sign-in into a workspace) is
 * explained in plain text instead of a dead switch.
 */
function SurfaceToggle({
  label,
  note,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  note?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-border/60 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{label}</p>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </div>
      <button
        aria-checked={checked}
        aria-label={label}
        className={cn(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-emerald-500" : "bg-muted-foreground/30",
          disabled && "cursor-not-allowed opacity-50",
        )}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform",
            checked ? "left-4" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={cn(
        "size-1.5 rounded-full",
        connected ? "bg-emerald-400" : "bg-muted-foreground/50",
      )}
    />
  );
}

/**
 * Where this provider runs, named the way the sidebar names it.
 *
 * The status is carried by the words, not by the dot: a member who cannot
 * distinguish the colours still reads "Runs in Rooms and Gen 2". The dot is
 * a second, redundant cue rather than the only one.
 *
 * "Connected, but runs nowhere" is its own state and says so. That case is
 * real — a Claude setup-token with no browser login runs in Workspaces but
 * not Rooms — and collapsing it into "Not connected" is what used to send
 * members off to reconnect something they already had.
 */
function RunsIn({
  surfaces,
  connected,
}: {
  surfaces: ExecutorSurface[];
  connected: boolean;
}) {
  if (surfaces.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <StatusDot connected={false} />
        {connected
          ? "Connected, but nothing here can run it yet"
          : "Not connected"}
      </p>
    );
  }
  const names = surfaces.map((surface) => SURFACE_LABEL[surface]);
  const spoken =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <StatusDot connected />
      <span className="sr-only">{`Runs in ${spoken}`}</span>
      <span aria-hidden>Runs in</span>
      {surfaces.map((surface) => (
        <span
          aria-hidden
          className="rounded-full border border-border/70 px-1.5 py-px text-[11px] font-medium text-foreground/80"
          key={surface}
        >
          {SURFACE_LABEL[surface]}
        </span>
      ))}
    </p>
  );
}

function FallbackRow({
  icon: Icon,
  title,
  description,
  connected,
  defaultOpen,
  children,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  description: string;
  connected?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="group border-t border-border/60" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-2.5 py-2.5 [&::-webkit-details-marker]:hidden">
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {connected ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot connected />
            Connected
          </span>
        ) : null}
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-2.5 pb-3">{children}</div>
    </details>
  );
}

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
   * `providerRunsIn`. The card states it rather than deducing it: the two
   * settings sections this replaced each described a surface in prose, and
   * keeping that prose true by hand is what produced a green "Ready for chat
   * rooms" for a login rooms cannot run.
   */
  runsIn: ExecutorSurface[];
  /** Claude's `codev claude-auth` setup-token — its workspace login. */
  claudeCliToken?: ClaudeCliTokenRecord;
}) {
  const router = useRouter();
  const [apiKeyState, setApiKeyState] = useState(connection);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<
    "connect" | "disconnect" | "save" | "revoke" | ""
  >("");
  const notify = useSettingsNotify();
  const [inlineMessage, setInlineMessage] = useState<{
    text: string;
    tone: "success" | "error";
  } | null>(null);
  const [confirming, setConfirming] = useState<
    "disconnect" | "revoke-key" | "revoke-cli" | null
  >(null);
  const [flow, setFlow] = useState<ActiveFlow | null>(null);
  const [connected, setConnected] = useState(
    subscription.status === "connected",
  );
  const provider: ProviderConnectionProvider = connection.provider;
  const apiKeyLabel = `${connection.label} API key`;
  const disabled = busy !== "";

  // Results go to a toast where the settings area provides one, and fall back
  // to an inline line otherwise. An empty string clears the inline line.
  function report(text: string, tone: "success" | "error") {
    if (notify) notify(text, tone);
    else setInlineMessage({ text, tone });
  }
  function setMessage(text: string) {
    if (!text) setInlineMessage(null);
    else report(text, "success");
  }
  function fail(text: string) {
    report(text, "error");
  }

  // Cursor is the only provider left with a browser sign-in: the tab does
  // the signing in and CoDev learns about it only by polling its own
  // callback. Claude and Codex connect through the rows below instead.
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartedAt = useRef(0);
  const stallNoticeShown = useRef(false);
  const isCursor = subscription.provider === "cursor";
  const showClaudeConnect =
    hostedClaudeConnect && subscription.provider === "claude";
  const showCodexConnect =
    hostedOpenAIConnect && subscription.provider === "codex";
  const showHostedConnect = showClaudeConnect || showCodexConnect;
  const cliTokenConnected = claudeCliToken?.status === "connected";
  // The sharing choice only exists for a login a workspace can actually run.
  const runsInAWorkspace =
    runsIn.includes("workspace") || runsIn.includes("gen2");
  const anythingConnected =
    connected || cliTokenConnected || apiKeyState.status === "connected";
  // Cursor's header button and the hosted Claude/Codex flow are the one
  // primary way in; without either, the methods below are all there is.
  const hasPrimaryAction = isCursor || showHostedConnect;
  const connectedVia = [
    connected ? "Signed in with a subscription" : null,
    cliTokenConnected ? "Signed in from the CLI" : null,
    apiKeyState.status === "connected"
      ? `API key ending ${apiKeyState.lastFour}`
      : null,
  ].filter((item): item is string => item !== null);
  useEffect(
    () => () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    },
    [],
  );

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  function finishConnected() {
    stopPolling();
    setFlow(null);
    setBusy("");
    setConnected(true);
    setMessage(`${label} is connected.`);
    router.refresh();
  }

  async function poll() {
    const response = await fetch("/api/auth/oauth/cursor/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      status?: string;
      error?: string;
    };
    if (!response.ok) {
      stopPolling();
      setFlow(null);
      setBusy("");
      fail(payload.error ?? `${label} sign-in failed. Start again.`);
      return;
    }
    if (payload.status === "connected") {
      finishConnected();
      return;
    }
    if (payload.status === "denied") {
      stopPolling();
      setFlow(null);
      setBusy("");
      setMessage(`${label} sign-in was cancelled.`);
      return;
    }
    // Still pending. Cursor's browser sign-in can quietly fail to hand a token
    // back to a non-CLI poller; nudge toward the API key rather than spinning
    // forever with no signal.
    if (
      isCursor &&
      pollStartedAt.current > 0 &&
      !stallNoticeShown.current &&
      Date.now() - pollStartedAt.current > 90_000
    ) {
      stallNoticeShown.current = true;
      setMessage(
        "Still waiting on Cursor. If you already finished signing in, connect with an API key below instead.",
      );
    }
  }

  async function connect() {
    setBusy("connect");
    setMessage("");
    setFlow(null);
    stopPolling();

    const response = await fetch("/api/auth/oauth/cursor/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scopeType: "USER", returnTo: RETURN_TO }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      mode?: string;
      loginUrl?: string;
      error?: string;
    };
    if (!response.ok) {
      setBusy("");
      fail(payload.error ?? `${label} sign-in could not start.`);
      return;
    }

    if (payload.mode === "cursor_deeplink" && payload.loginUrl) {
      window.open(payload.loginUrl, "_blank", "noopener,noreferrer");
      setFlow({ kind: "polling", loginUrl: payload.loginUrl });
      pollStartedAt.current = Date.now();
      stallNoticeShown.current = false;
      void poll();
      pollTimer.current = setInterval(() => void poll(), 2000);
      return;
    }

    setBusy("");
    fail(`${label} returned an unexpected sign-in response.`);
  }

  function cancelFlow() {
    stopPolling();
    setFlow(null);
    setBusy("");
  }

  async function disconnect() {
    setBusy("disconnect");
    setMessage("");
    try {
      const response = await fetch(
        `/api/personal/subscriptions?provider=${subscription.provider}`,
        { method: "DELETE" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        fail(payload?.error ?? "The account could not be disconnected.");
        return;
      }
      setConnected(false);
      setMessage(`${label} disconnected.`);
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  async function save() {
    setBusy("save");
    setMessage("");
    try {
      // Cursor: exchange the user API key for the same token pair the browser
      // login yields, so it lands as one `cursor` connection either way and
      // `cursor-agent` gets a real refreshable session, not a bare key.
      if (isCursor) {
        const response = await fetch("/api/auth/oauth/cursor/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiKey: draft.trim(), scopeType: "USER" }),
        });
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!response.ok) {
          fail(payload?.error ?? "The Cursor API key was not accepted.");
          return;
        }
        setDraft("");
        finishConnected();
        return;
      }

      const response = await fetch("/api/personal/connections", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, apiKey: draft.trim() }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        fail(payload?.error ?? "The key could not be saved.");
        return;
      }
      const next = (payload.connections as ProviderConnectionRecord[]).find(
        (row) => row.provider === provider,
      );
      if (next) setApiKeyState(next);
      setDraft("");
      setMessage(`${apiKeyLabel} saved.`);
    } finally {
      setBusy("");
    }
  }

  async function revoke() {
    setBusy("revoke");
    setMessage("");
    try {
      const response = await fetch(
        `/api/personal/connections?provider=${provider}`,
        { method: "DELETE" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        fail(payload?.error ?? "The key could not be revoked.");
        return;
      }
      const next = (payload.connections as ProviderConnectionRecord[]).find(
        (row) => row.provider === provider,
      );
      if (next) setApiKeyState(next);
      setDraft("");
      setMessage(`${apiKeyLabel} revoked.`);
    } finally {
      setBusy("");
    }
  }

  /**
   * Flip whether this credential may fund a turn inside a shared workspace.
   *
   * It used to be a pair of "also use in <other surface>" switches. Those
   * wrote two columns that only one resolution path out of three ever read,
   * so flipping one changed a badge and nothing else; where a credential can
   * run is now the provider registry's answer. This is the part that was
   * genuinely the member's to decide: whose subscription gets spent when the
   * work lands somewhere other people can see.
   */
  async function setSharedWorkspaceUse(
    kind: "api_key" | "subscription" | "claude_cli_token",
    enabled: boolean,
  ) {
    setBusy("save");
    setMessage("");
    try {
      const response = await fetch("/api/personal/connections", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          kind,
          surface: "workspace",
          enabled,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        fail(payload?.error ?? "The setting could not be saved.");
        return;
      }
      setMessage(
        enabled
          ? `${label} can be used in shared workspaces.`
          : `${label} will stay out of shared workspaces.`,
      );
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  async function revokeClaudeCliToken() {
    setBusy("revoke");
    setMessage("");
    try {
      const response = await fetch(
        "/api/personal/connections?provider=anthropic&kind=claude_cli_token",
        { method: "DELETE" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        fail(payload?.error ?? "The CLI login could not be revoked.");
        return;
      }
      setMessage(`${label} CLI login revoked.`);
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  return (
    <Card className="px-4 py-3.5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-6 items-center justify-center text-foreground">
          {logo}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{label}</h3>
          <RunsIn connected={anythingConnected} surfaces={runsIn} />
        </div>
        {isCursor ? (
          connected ? (
            <div className="flex shrink-0 gap-2">
              <Button
                disabled={disabled}
                onClick={() => void connect()}
                size="sm"
                type="button"
                variant="outline"
              >
                Reconnect
              </Button>
              <Button
                disabled={disabled}
                onClick={() => setConfirming("disconnect")}
                size="sm"
                type="button"
                variant="outline"
              >
                {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>
          ) : (
            <Button
              className="shrink-0"
              disabled={disabled}
              onClick={() => void connect()}
              size="sm"
              type="button"
            >
              {busy === "connect" && !flow ? "Starting…" : `Connect ${label}`}
            </Button>
          )
        ) : connected ? (
          <Button
            disabled={disabled}
            onClick={() => setConfirming("disconnect")}
            size="sm"
            type="button"
            variant="outline"
          >
            {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
          </Button>
        ) : null}
      </div>

      {showClaudeConnect ? (
        <ClaudeHostedConnect
          connected={connected}
          onConnected={finishConnected}
        />
      ) : null}

      {showCodexConnect ? (
        <CodexHostedConnect
          connected={connected}
          onConnected={finishConnected}
        />
      ) : null}

      {flow?.kind === "polling" ? (
        <div className="mt-3 flex items-center gap-2.5 rounded-md border border-border bg-background/60 p-3">
          <p className="flex-1 text-xs text-muted-foreground">
            Finish signing in on the {label} tab (
            <a
              className="underline"
              href={flow.loginUrl}
              rel="noreferrer"
              target="_blank"
            >
              reopen
            </a>
            ). Keep this page open…
          </p>
          <Button
            onClick={cancelFlow}
            size="sm"
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
        </div>
      ) : null}

      {anythingConnected ? (
        <p className="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check aria-hidden className="size-3.5 shrink-0 text-emerald-400" />
          {connectedVia.join(" · ")}
        </p>
      ) : null}

      {/* One primary action sits in the header (or the hosted flow above);
          every other method lives behind a single disclosure so a member sees
          one way in, not three. */}
      <details
        className="group mt-3 rounded-lg border border-border/60 px-3"
        open={!anythingConnected && !hasPrimaryAction}
      >
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium [&::-webkit-details-marker]:hidden">
          {anythingConnected
            ? "Manage connection"
            : hasPrimaryAction
              ? "Other ways to connect"
              : "Choose how to connect"}
          <ChevronDown
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          />
        </summary>
        {
          <FallbackRow
            connected={apiKeyState.status === "connected"}
            // Open only when there is nothing else to use: the connect
            // buttons above are the shorter path for most members.
            defaultOpen={!anythingConnected && !showHostedConnect}
            description={
              isCursor
                ? "From cursor.com → Dashboard → API Keys. More reliable than the browser sign-in — CoDev exchanges it for a real session."
                : `Bill usage to your own ${connection.label} account instead of a subscription.`
            }
            icon={KeyRound}
            title={
              isCursor
                ? "Connect with a Cursor API key"
                : "Use an API key instead"
            }
          >
            {apiKeyState.status === "connected" ? (
              <p className="text-xs text-muted-foreground">
                Saved by {apiKeyState.suppliedBy} · ending{" "}
                {apiKeyState.lastFour}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`api-key-${provider}`}>
                {apiKeyLabel}
              </label>
              <Input
                autoComplete="off"
                className="min-w-[12rem] flex-1"
                disabled={disabled}
                id={`api-key-${provider}`}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={isCursor ? "key_…" : "Paste API key"}
                spellCheck={false}
                type="password"
                value={draft}
              />
              <Button
                disabled={disabled || !draft.trim()}
                onClick={() => void save()}
                size="sm"
                type="button"
                variant="outline"
              >
                {busy === "save"
                  ? isCursor
                    ? "Connecting…"
                    : "Saving…"
                  : isCursor
                    ? connected
                      ? "Replace"
                      : "Connect"
                    : apiKeyState.status === "connected"
                      ? "Replace key"
                      : "Save key"}
              </Button>
              {apiKeyState.status === "connected" ? (
                <Button
                  disabled={disabled}
                  onClick={() => setConfirming("revoke-key")}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  {busy === "revoke" ? "Revoking…" : "Revoke"}
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Keys are encrypted on the CoDev server and never shown again after
              you save them.
            </p>
          </FallbackRow>
        }

        {subscription.command ? (
          <FallbackRow
            connected={
              cliTokenConnected ||
              (connected && subscription.provenance === "cli")
            }
            defaultOpen={!anythingConnected && !showHostedConnect}
            description="Sign in from your own terminal with the CoDev CLI."
            icon={Terminal}
            title="Connect from a terminal"
          >
            {subscription.provider === "claude" && cliTokenConnected ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Connected via codev claude-auth
                  {claudeCliToken?.lastFour
                    ? ` · ending ${claudeCliToken.lastFour}`
                    : ""}
                </p>
                <Button
                  disabled={disabled}
                  onClick={() => setConfirming("revoke-cli")}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {busy === "revoke" ? "Revoking…" : "Revoke"}
                </Button>
              </div>
            ) : null}
            <CopyableCommand command="npm install -g @trycodev/cli" />
            <CopyableCommand command="codev login" />
            <CopyableCommand command={subscription.command} />
          </FallbackRow>
        ) : null}
      </details>

      {runsInAWorkspace ? (
        <div className="mt-3 space-y-1">
          <h4 className="text-xs font-semibold">
            Billing in shared workspaces
          </h4>
          <SurfaceToggle
            checked={subscription.allowInSharedWorkspaces}
            disabled={disabled}
            label="Allow in shared workspaces"
            note="Turns you start in a workspace other people can see run on this login, and are billed to you."
            onChange={(next) =>
              void setSharedWorkspaceUse("subscription", next)
            }
          />
        </div>
      ) : null}

      {inlineMessage ? (
        <p
          className={cn(
            "pt-2.5 text-xs",
            inlineMessage.tone === "error"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
          role={inlineMessage.tone === "error" ? "alert" : "status"}
        >
          {inlineMessage.text}
        </p>
      ) : null}

      {confirming === "disconnect" ? (
        <ConfirmDialog
          busy={busy !== ""}
          confirmLabel={`Disconnect ${label}`}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            void disconnect();
          }}
          title={`Disconnect ${label}?`}
        >
          Agents will stop running on this {label} login until you connect it
          again. Any API key you saved stays in place.
        </ConfirmDialog>
      ) : null}
      {confirming === "revoke-key" ? (
        <ConfirmDialog
          busy={busy !== ""}
          confirmLabel="Revoke key"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            void revoke();
          }}
          title={`Revoke the ${label} API key?`}
        >
          The saved key is deleted from CoDev. You will need to paste it again
          to use it.
        </ConfirmDialog>
      ) : null}
      {confirming === "revoke-cli" ? (
        <ConfirmDialog
          busy={busy !== ""}
          confirmLabel="Revoke login"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            void revokeClaudeCliToken();
          }}
          title={`Revoke the ${label} CLI login?`}
        >
          Run the CLI command again to reconnect.
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}
