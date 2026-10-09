"use client";

import { useState } from "react";
import { FileUp, Loader2, X } from "lucide-react";

import type {
  Gen2SessionImportPreview,
  Gen2SessionImportProvider,
} from "@codev/contracts";
import { MarkdownContent } from "@/components/markdown/markdown-content";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { ProviderLogo } from "./provider-logos";
import { WorkspaceButton } from "./workspace-button";

const SOURCES: Record<
  Gen2SessionImportProvider,
  { label: string; folder: string; file: string }
> = {
  codex: {
    label: "Codex",
    folder: "~/.codex/sessions",
    file: "YYYY/MM/DD/rollout-….jsonl",
  },
  claude: {
    label: "Claude Code",
    folder: "~/.claude/projects",
    file: "<project>/<session id>.jsonl",
  },
};

function SessionPreview({ preview }: { preview: Gen2SessionImportPreview }) {
  const hidden = preview.redactions.reduce((sum, r) => sum + r.count, 0);
  const repo = [preview.repo.branch, preview.repo.commit?.slice(0, 7)]
    .filter(Boolean)
    .join(" @ ");
  return (
    <div className="gen2-session-import-preview">
      <p className="gen2-session-import-stats">
        {preview.messageCount} messages · {preview.itemCount} tool steps
        {preview.startedAt
          ? ` · started ${new Date(preview.startedAt).toLocaleString()}`
          : ""}
        {repo ? ` · ${repo}` : ""}
      </p>
      {hidden > 0 ? (
        <Alert>
          <AlertTitle>{hidden} secrets hidden</AlertTitle>
          <AlertDescription>
            {preview.redactions.map((r) => `${r.count} ${r.kind}`).join(", ")}{" "}
            were replaced with [REDACTED] before saving.
          </AlertDescription>
        </Alert>
      ) : null}
      {preview.editedFiles.length > 0 ? (
        <Alert>
          <AlertTitle>
            The session changed {preview.editedFiles.length} files
          </AlertTitle>
          <AlertDescription>
            Only the conversation is imported. Push any uncommitted local
            changes so this workspace can see them.
          </AlertDescription>
        </Alert>
      ) : null}
      <ol className="gen2-session-import-sample" aria-label="Sample messages">
        {preview.sample.map((message, index) => (
          <li key={index} data-role={message.role}>
            <span className="gen2-session-import-role">
              {message.role === "user"
                ? "You"
                : SOURCES[preview.provider].label}
            </span>
            <MarkdownContent
              className="gen2-chat-markdown"
              text={
                message.body.length > 600
                  ? `${message.body.slice(0, 600)}…`
                  : message.body
              }
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

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
  const [dragging, setDragging] = useState(false);
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

  const source = SOURCES[provider];
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
        className="gen2-workspace-surface gen2-session-import sm:max-w-[600px]"
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
            <SessionPreview preview={preview} />
          </FieldGroup>
        ) : (
          <FieldGroup>
            <Field>
              <FieldLabel>Agent</FieldLabel>
              <ToggleGroup
                type="single"
                value={provider}
                onValueChange={(value) =>
                  value && setProvider(value as Gen2SessionImportProvider)
                }
              >
                {(["codex", "claude"] as const).map((id) => (
                  <ToggleGroupItem key={id} value={id}>
                    <ProviderLogo provider={id} size={14} />
                    {SOURCES[id].label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="session-import-file">
                Session file
              </FieldLabel>
              <FieldDescription>
                Find it in <code>{source.folder}</code> as{" "}
                <code>{source.file}</code>. Up to 64 MB.
              </FieldDescription>
              <label
                htmlFor="session-import-file"
                className="gen2-session-import-drop"
                data-dragging={dragging || undefined}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  void upload(event.dataTransfer.files[0]);
                }}
              >
                {pending ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : (
                  <FileUp aria-hidden="true" />
                )}
                <span>
                  {pending
                    ? "Reading and redacting…"
                    : "Drop a .jsonl file here, or click to choose"}
                </span>
              </label>
              <input
                id="session-import-file"
                type="file"
                accept=".jsonl,application/x-ndjson,application/json"
                className="sr-only"
                disabled={pending}
                onChange={(event) => {
                  void upload(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </Field>
          </FieldGroup>
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
