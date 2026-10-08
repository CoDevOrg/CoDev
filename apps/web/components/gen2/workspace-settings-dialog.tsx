"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, X } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ProviderAccountList } from "@/components/settings/provider-account-list";
import type { ProviderConnectionSnapshot } from "@/lib/providers/provider-connection-view";
import { WorkspaceButton } from "./workspace-button";

type Load = "loading" | "ready" | "error";

/**
 * The member's own settings, opened from inside a workspace so connecting an
 * agent account never means leaving the work. It shows the same cards as the
 * settings page; every change reloads them and tells the workspace, so the
 * composer can use a newly connected account straight away.
 */
export function WorkspaceSettingsDialog({
  open,
  onOpenChange,
  onProvidersChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProvidersChanged: () => void;
}) {
  const [snapshot, setSnapshot] = useState<ProviderConnectionSnapshot | null>(
    null,
  );
  const [load, setLoad] = useState<Load>("loading");

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/personal/connections", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(String(response.status));
      setSnapshot((await response.json()) as ProviderConnectionSnapshot);
      setLoad("ready");
    } catch {
      setLoad((current) => (current === "ready" ? current : "error"));
    }
  }, []);

  useEffect(() => {
    // Load each time the dialog opens: a login made in another tab, or on
    // the settings page, shows up without a page reload.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void reload();
  }, [open, reload]);

  const changed = useCallback(() => {
    void reload();
    onProvidersChanged();
  }, [reload, onProvidersChanged]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="gen2-workspace-surface max-h-[min(88vh,52rem)] overflow-y-auto sm:max-w-[600px]"
      >
        <DialogClose asChild>
          <WorkspaceButton
            size="icon"
            className="gen2-workspace-dialog-close"
            aria-label="Close"
          >
            <X aria-hidden="true" />
          </WorkspaceButton>
        </DialogClose>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Agents you start in this workspace run on your own accounts.
            Everyone here connects their own; nobody else can use yours.
          </DialogDescription>
        </DialogHeader>

        <ProvidersSection
          load={load}
          onChange={changed}
          onRetry={() => void reload()}
          snapshot={snapshot}
        />

        <DialogFooter className="sm:justify-between">
          <Link
            href="/settings/personal/providers"
            target="_blank"
            rel="noopener noreferrer"
            className="gen2-workspace-button inline-flex items-center"
            data-slot="button"
            data-tone="ghost"
          >
            All settings
            <ExternalLink aria-hidden="true" size={14} />
          </Link>
          <DialogClose asChild>
            <WorkspaceButton tone="secondary">Done</WorkspaceButton>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProvidersSection({
  snapshot,
  load,
  onChange,
  onRetry,
}: {
  snapshot: ProviderConnectionSnapshot | null;
  load: Load;
  onChange: () => void;
  onRetry: () => void;
}) {
  return (
    <section
      aria-labelledby="workspace-settings-providers"
      className="flex min-w-0 flex-col gap-3"
    >
      <h3
        id="workspace-settings-providers"
        className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground"
      >
        AI providers
      </h3>
      {snapshot ? (
        <ProviderAccountList
          dialogClassName="gen2-workspace-surface"
          onChange={onChange}
          snapshot={snapshot}
        />
      ) : load === "error" ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            Your accounts couldn’t be loaded.
            <WorkspaceButton tone="secondary" onClick={onRetry}>
              Try again
            </WorkspaceButton>
          </AlertDescription>
        </Alert>
      ) : (
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">Loading your accounts…</span>
          {[0, 1, 2].map((row) => (
            <Skeleton className="h-28 w-full rounded-xl" key={row} />
          ))}
        </div>
      )}
    </section>
  );
}
