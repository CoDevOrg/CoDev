"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SURFACE_LABEL } from "@/lib/providers/provider-surface-capability";
import type { ExecutorSurface } from "@/lib/providers/registry";

export function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5">
      <code className="min-w-0 flex-1 truncate font-mono text-xs">
        {command}
      </code>
      <Button
        aria-label="Copy command"
        onClick={() => {
          void navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
    </div>
  );
}

/** Whether anything is connected, in words as well as color. */
export function ConnectionBadge({ connected }: { connected: boolean }) {
  return connected ? (
    <Badge variant="secondary">
      <Check aria-hidden className="size-3" />
      Connected
    </Badge>
  ) : (
    <Badge variant="outline">Not connected</Badge>
  );
}

/** Where this provider runs, named the way the product navigation names it. */
export function RunsIn({
  surfaces,
  connected,
}: {
  surfaces: ExecutorSurface[];
  connected: boolean;
}) {
  // A disconnected account runs nowhere; its badge already says so.
  if (surfaces.length === 0) {
    return connected ? (
      <p className="text-sm text-muted-foreground">
        Connected, but nothing here can run it yet
      </p>
    ) : null;
  }
  const names = surfaces.map((surface) => SURFACE_LABEL[surface]);
  const spoken =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
      <span className="sr-only">{`Runs in ${spoken}`}</span>
      <span aria-hidden>Runs in</span>
      {surfaces.map((surface) => (
        <Badge aria-hidden key={surface} variant="outline">
          {SURFACE_LABEL[surface]}
        </Badge>
      ))}
    </p>
  );
}

/** One way to connect, shown flat rather than as a disclosure of its own. */
export function ConnectSection({
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
    <section className="flex flex-col gap-3 py-3">
      <div className="flex items-start gap-2.5">
        <Icon
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h4 className="text-sm font-medium">{title}</h4>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {connected ? <Badge variant="secondary">Connected</Badge> : null}
      </div>
      <div className="flex flex-col gap-3 pl-6.5">{children}</div>
    </section>
  );
}
