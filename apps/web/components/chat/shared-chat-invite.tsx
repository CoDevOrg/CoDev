"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Link2, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type InviteResponse = {
  inviteUrl?: string;
  expiresAt?: string;
  reused?: boolean;
  error?: string;
};

export function SharedChatInvite({ roomId }: { roomId: string }) {
  const [inviteUrl, setInviteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reused, setReused] = useState(false);
  const [error, setError] = useState("");

  async function createInvite() {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const response = await fetch(`/api/rooms/${roomId}/invites`, {
        method: "POST",
      });
      const payload = (await response
        .json()
        .catch(() => null)) as InviteResponse | null;
      if (!response.ok || !payload?.inviteUrl) {
        setError(payload?.error ?? "The invite link could not be created.");
        return;
      }
      setInviteUrl(payload.inviteUrl);
      setReused(payload.reused === true);
    } catch {
      setError("CoDev could not create an invite link. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setError("");
    } catch {
      setError("Copy failed. Select and copy the link manually.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => void createInvite()}
        className="h-8 rounded-full px-3 text-xs"
      >
        {busy ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Link2 aria-hidden="true" className="size-3.5" />
        )}
        {busy ? "Creating…" : "Invite people"}
      </Button>
      <AnimatePresence>
        {inviteUrl ? (
          <motion.div
            aria-live="polite"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <Card className="flex flex-col gap-2 p-3">
              <div>
                <strong className="block text-[12px] font-semibold">
                  {reused ? "Saved invite link" : "Invite link ready"}
                </strong>
                <span className="text-[11px] text-muted-foreground">
                  It expires in 24 hours and works once.
                </span>
              </div>
              <code className="overflow-hidden text-ellipsis whitespace-nowrap rounded-md border border-border bg-muted px-2 py-1.5 text-[10.5px]">
                {inviteUrl}
              </code>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void copyInvite()}
                className="h-7 self-start rounded-full px-2.5 text-[11px]"
              >
                {copied ? (
                  <Check aria-hidden="true" className="size-3" />
                ) : (
                  <Copy aria-hidden="true" className="size-3" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </Card>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {error ? (
        <p role="alert" className="m-0 text-[11px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
