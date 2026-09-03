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
import { Input } from "@/components/ui/input";
import { OrcaCard } from "@/components/settings/orca-style";
import type {
  CliSubscriptionRecord,
  ProviderConnectionProvider,
  ProviderConnectionRecord,
} from "@/lib/provider-connection-view";
import { cn } from "@/lib/utils";

const RETURN_TO = "/settings/personal/providers";

/**
 * The in-page sign-in state for one provider. Each provider's official login
 * ends somewhere different — Claude hands back a code to paste, Codex shows a
 * device code to type into ChatGPT, Cursor just redirects — so the card keeps
 * whichever step is currently on screen rather than a single boolean.
 */
type ActiveFlow =
  | { kind: "manual_code"; authorizeUrl: string }
  | {
      kind: "device_code";
      verificationUrl: string;
      userCode: string;
      deviceAuthId: string;
      intervalSeconds: number;
    }
  | { kind: "polling"; loginUrl: string };

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">
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
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
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

function FallbackRow({
  icon: Icon,
  title,
  description,
  connected,
  children,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  description: string;
  connected?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="group border-t border-border/60">
      <summary className="flex cursor-pointer list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {connected ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot connected />
            Connected
          </span>
        ) : null}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 pb-4">{children}</div>
    </details>
  );
}

export function ProviderAccountCard({
  logo,
  label,
  subscription,
  connection,
}: {
  logo: ReactNode;
  label: string;
  subscription: CliSubscriptionRecord;
  connection: ProviderConnectionRecord;
}) {
  const router = useRouter();
  const [apiKeyState, setApiKeyState] = useState(connection);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<
    "connect" | "disconnect" | "save" | "revoke" | ""
  >("");
  const [message, setMessage] = useState("");
  const [flow, setFlow] = useState<ActiveFlow | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [connected, setConnected] = useState(
    subscription.status === "connected",
  );
  const provider: ProviderConnectionProvider = connection.provider;
  const apiKeyLabel = `${connection.label} API key`;
  const disabled = busy !== "";

  // Codex and Cursor finish out of band: the browser tab does the signing in
  // and CoDev learns about it only by polling its own callback.
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
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
    setManualCode("");
    setConnected(true);
    setMessage(`${label} is connected.`);
    router.refresh();
  }

  async function poll(body: Record<string, string> = {}) {
    const endpoint =
      subscription.provider === "cursor"
        ? "/api/auth/oauth/cursor/poll"
        : "/api/auth/oauth/codex/poll";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      status?: string;
      error?: string;
    };
    if (!response.ok) {
      stopPolling();
      setFlow(null);
      setBusy("");
      setMessage(payload.error ?? `${label} sign-in failed. Start again.`);
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
    }
  }

  async function connect() {
    setBusy("connect");
    setMessage("");
    setFlow(null);
    stopPolling();

    if (subscription.connectMode === "app_callback") {
      window.location.assign(
        `/api/auth/oauth/${subscription.provider}?returnTo=${encodeURIComponent(RETURN_TO)}`,
      );
      return;
    }

    const response = await fetch(
      `/api/auth/oauth/${subscription.provider}/session`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scopeType: "USER", returnTo: RETURN_TO }),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      mode?: string;
      authorizeUrl?: string;
      loginUrl?: string;
      verificationUrl?: string;
      userCode?: string;
      deviceAuthId?: string;
      intervalSeconds?: number;
      error?: string;
    };
    if (!response.ok) {
      setBusy("");
      setMessage(payload.error ?? `${label} sign-in could not start.`);
      return;
    }

    if (payload.mode === "manual_code" && payload.authorizeUrl) {
      window.open(payload.authorizeUrl, "_blank", "noopener,noreferrer");
      setFlow({ kind: "manual_code", authorizeUrl: payload.authorizeUrl });
      setBusy("");
      return;
    }

    if (payload.mode === "cursor_deeplink" && payload.loginUrl) {
      window.open(payload.loginUrl, "_blank", "noopener,noreferrer");
      setFlow({ kind: "polling", loginUrl: payload.loginUrl });
      void poll();
      pollTimer.current = setInterval(() => void poll(), 2000);
      return;
    }

    if (
      payload.mode === "device_code" &&
      payload.userCode &&
      payload.deviceAuthId &&
      payload.verificationUrl
    ) {
      const device = {
        deviceAuthId: payload.deviceAuthId,
        userCode: payload.userCode,
      };
      window.open(payload.verificationUrl, "_blank", "noopener,noreferrer");
      setFlow({
        kind: "device_code",
        verificationUrl: payload.verificationUrl,
        intervalSeconds: payload.intervalSeconds ?? 5,
        ...device,
      });
      void poll(device);
      pollTimer.current = setInterval(
        () => void poll(device),
        Math.max(payload.intervalSeconds ?? 5, 2) * 1000,
      );
      return;
    }

    if (payload.mode === "app_callback" && payload.authorizeUrl) {
      window.location.assign(payload.authorizeUrl);
      return;
    }

    setBusy("");
    setMessage(`${label} returned an unexpected sign-in response.`);
  }

  async function submitManualCode() {
    setBusy("connect");
    setMessage("");
    const response = await fetch(
      `/api/auth/oauth/${subscription.provider}/complete`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: manualCode }),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    if (!response.ok) {
      setBusy("");
      setMessage(payload.error ?? `${label} authorization failed.`);
      return;
    }
    finishConnected();
  }

  function cancelFlow() {
    stopPolling();
    setFlow(null);
    setBusy("");
    setManualCode("");
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
        setMessage(payload?.error ?? "The account could not be disconnected.");
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
      const response = await fetch("/api/personal/connections", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, apiKey: draft.trim() }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(payload?.error ?? "The key could not be saved.");
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
        setMessage(payload?.error ?? "The key could not be revoked.");
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

  return (
    <OrcaCard className="px-6 py-5">
      <div className="flex items-center gap-3">
        <span className="flex size-7 items-center justify-center text-foreground">
          {logo}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold">{label}</h3>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot connected={connected} />
            {connected
              ? "Signed in with your subscription"
              : "Sign in with your account — no API key needed"}
          </p>
        </div>
        {connected ? (
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
              onClick={() => void disconnect()}
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
        )}
      </div>

      {flow?.kind === "manual_code" ? (
        <div className="mt-4 space-y-3 rounded-md border border-border bg-background/60 p-4">
          <p className="text-xs text-muted-foreground">
            Finish signing in on the {label} tab (
            <a
              className="underline"
              href={flow.authorizeUrl}
              rel="noreferrer"
              target="_blank"
            >
              reopen
            </a>
            ), then paste the authorization code it gives you.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label={`${label} authorization code`}
              autoComplete="off"
              className="min-w-[12rem] flex-1"
              onChange={(event) => setManualCode(event.target.value)}
              placeholder="Paste code"
              spellCheck={false}
              value={manualCode}
            />
            <Button
              disabled={disabled || !manualCode.trim()}
              onClick={() => void submitManualCode()}
              size="sm"
              type="button"
            >
              {busy === "connect" ? "Connecting…" : "Finish"}
            </Button>
            <Button
              onClick={cancelFlow}
              size="sm"
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {flow?.kind === "device_code" ? (
        <div className="mt-4 space-y-3 rounded-md border border-border bg-background/60 p-4">
          <p className="text-xs text-muted-foreground">
            Enter this code on{" "}
            <a
              className="underline"
              href={flow.verificationUrl}
              rel="noreferrer"
              target="_blank"
            >
              {flow.verificationUrl}
            </a>
            . Keep this page open.
          </p>
          <p className="font-mono text-lg tracking-[0.3em]">{flow.userCode}</p>
          <div className="flex items-center gap-3">
            <p className="text-xs text-muted-foreground">
              Waiting for authorization…
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
        </div>
      ) : null}

      {flow?.kind === "polling" ? (
        <div className="mt-4 flex items-center gap-3 rounded-md border border-border bg-background/60 p-4">
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
          <Button onClick={cancelFlow} size="sm" type="button" variant="secondary">
            Cancel
          </Button>
        </div>
      ) : null}

      <div className="mt-4">
        <FallbackRow
          connected={apiKeyState.status === "connected"}
          description={`Bill usage to your own ${connection.label} account instead of a subscription.`}
          icon={KeyRound}
          title="Use an API key instead"
        >
          {apiKeyState.status === "connected" ? (
            <p className="text-xs text-muted-foreground">
              Saved by {apiKeyState.suppliedBy} · ending {apiKeyState.lastFour}
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
              placeholder="Paste API key"
              spellCheck={false}
              type="password"
              value={draft}
            />
            <Button
              disabled={disabled}
              onClick={() => void save()}
              size="sm"
              type="button"
              variant="outline"
            >
              {busy === "save"
                ? "Saving…"
                : apiKeyState.status === "connected"
                  ? "Replace key"
                  : "Save key"}
            </Button>
            {apiKeyState.status === "connected" ? (
              <Button
                disabled={disabled}
                onClick={() => void revoke()}
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

        {subscription.command ? (
          <FallbackRow
            description="Run the same sign-in from the CoDev CLI."
            icon={Terminal}
            title="Connect from a terminal"
          >
            <CopyableCommand command="npm install -g @trycodev/cli" />
            <CopyableCommand command="codev login" />
            <CopyableCommand command={subscription.command} />
          </FallbackRow>
        ) : null}
      </div>

      {message ? (
        <p className="pt-3 text-xs text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </OrcaCard>
  );
}
