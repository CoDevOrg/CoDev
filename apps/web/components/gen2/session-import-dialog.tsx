"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";

import type {
  Gen2SessionImportPreview,
  Gen2SessionImportProvider,
} from "@codev/contracts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { SessionImportPicker } from "./session-import-picker";
import { SessionImportPreview } from "./session-import-preview";
import { WorkspaceButton } from "./workspace-button";

/**
 * Uploads a local Codex or Claude Code session, shows what will be imported
 * (with secrets already hidden), and turns it into a workspace chat.
 */
export function SessionImportDialog({
  open,
  onOpenChange,
  workspaceId,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onImported: (chatId: string, provider: Gen2SessionImportProvider) => void;
}) {
  const [provider, setProvider] = useState<Gen2SessionImportProvider>("codex");
  const [preview, setPreview] = useState<Gen2SessionImportPreview | null>(null);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/session-imports`;

  async function call(path: string, init: RequestInit) {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`${base}${path}`, init);
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Import failed.");
      return body;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import failed.");
      return null;
    } finally {
      setPending(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file || pending) return;
    const form = new FormData();
    form.set("provider", provider);
    form.set("file", file);
    const body = await call("", { method: "POST", body: form });
    const next = (body as { preview?: Gen2SessionImportPreview } | null)
      ?.preview;
    if (!next) return;
    setPreview(next);
    setTitle(next.title);
  }

  function reset() {
    if (preview) {
      void fetch(`${base}/${preview.importId}`, { method: "DELETE" });
    }
    setPreview(null);
    setError("");
  }

  async function confirm() {
    if (!preview) return;
    const body = await call(`/${preview.importId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() || undefined }),
    });
    const chatId = (body as { chatId?: string } | null)?.chatId;
    if (!chatId) return;
    setPreview(null);
    onImported(chatId, preview.provider);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) reset();
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="gen2-workspace-surface gen2-session-import grid-cols-[minmax(0,1fr)] sm:max-w-[600px]"
      >
        <DialogClose asChild>
          <WorkspaceButton
            size="icon"
            className="gen2-workspace-dialog-close"
            aria-label="Close"
            disabled={pending}
          >
            <X aria-hidden="true" />
          </WorkspaceButton>
        </DialogClose>
        <DialogHeader>
          <DialogTitle>
            {preview ? "Review import" : "Import a local session"}
          </DialogTitle>
          <DialogDescription>
            {preview
              ? "Everyone in this workspace will see this chat. Continuing it uses the recent messages as context."
              : "Bring a Codex or Claude Code session into this workspace as a chat."}
          </DialogDescription>
        </DialogHeader>

        {preview ? (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="session-import-title">Chat name</FieldLabel>
              <Input
                id="session-import-title"
                value={title}
                maxLength={80}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <SessionImportPreview preview={preview} />
          </FieldGroup>
        ) : (
          <SessionImportPicker
            provider={provider}
            onProviderChange={setProvider}
            pending={pending}
            onFile={(file) => void upload(file)}
          />
        )}

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {preview ? (
          <DialogFooter>
            <WorkspaceButton tone="ghost" disabled={pending} onClick={reset}>
              Choose another file
            </WorkspaceButton>
            <WorkspaceButton
              tone="primary"
              disabled={pending}
              onClick={() => void confirm()}
            >
              {pending ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : null}
              Import chat
            </WorkspaceButton>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
