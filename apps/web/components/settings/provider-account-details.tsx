"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
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

export function SurfaceToggle({
  heading,
  label,
  note,
  checked,
  disabled,
  onChange,
}: {
  /** A section title above the switch, for a choice with a cost attached. */
  heading?: string;
  label: string;
  note?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Separator />
      {heading ? <h4 className="text-sm font-semibold">{heading}</h4> : null}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm font-medium">{label}</p>
          {note ? (
            <p className="text-sm text-muted-foreground">{note}</p>
          ) : null}
        </div>
        <Switch
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
        />
      </div>
    </div>
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
  if (surfaces.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
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

export function FallbackRow({
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
    <details className="group" open={defaultOpen}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 [&::-webkit-details-marker]:hidden">
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {connected ? <Badge variant="secondary">Connected</Badge> : null}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-3 pt-3">{children}</div>
    </details>
  );
}
