import type { CliSubscriptionRecord } from "@/lib/provider-connection-view";
import { OrcaCard } from "@/components/settings/orca-style";

const PROVIDER_COPY: Record<
  CliSubscriptionRecord["provider"],
  { emoji: string; blurb: string }
> = {
  claude: {
    emoji: "☀️",
    blurb:
      "Optional. CoDev can use your Claude Code CLI login; connect it for quick access without pasting an API key.",
  },
  codex: {
    emoji: "⚙️",
    blurb:
      "Optional. CoDev can use your Codex CLI login; connect it for quick access without pasting an API key.",
  },
};

export function CliAccountSection({
  subscription,
}: {
  subscription: CliSubscriptionRecord;
}) {
  const connected = subscription.status === "connected";
  const copy = PROVIDER_COPY[subscription.provider];

  return (
    <OrcaCard className="space-y-4">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <span aria-hidden="true">{copy.emoji}</span>
          {subscription.label}
        </h3>
        <p className="text-xs text-muted-foreground">{copy.blurb}</p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Accounts</p>
        <div className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">System default</p>
            {connected ? (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
                Active
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {connected
              ? `Connected via ${subscription.command}.`
              : `Not connected · run ${subscription.command} to connect.`}
          </p>
        </div>
        {!connected ? (
          <div className="rounded-md border border-dashed border-border p-3">
            <p className="text-xs text-muted-foreground">
              No {subscription.label} login connected yet. Run{" "}
              <code>{subscription.command}</code> from a terminal, or paste an
              API key above instead.
            </p>
          </div>
        ) : null}
      </div>
    </OrcaCard>
  );
}
