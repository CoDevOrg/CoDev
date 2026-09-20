"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const MAX_SOURCE_BYTES = 5 * 1_024 * 1_024;

async function responseError(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? "The request could not be completed. Please try again.";
}

export function WorkspaceSessionImportUpload({
  workspaceId,
  canUpload,
}: {
  workspaceId: string;
  canUpload: boolean;
}) {
  const router = useRouter();
  const [selection, setSelection] = useState<{
    file: File;
    idempotencyKey: string;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [provider, setProvider] = useState<"codex" | "claude" | "cursor">(
    "codex",
  );

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selection || pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/session-imports/source`,
        {
          method: "POST",
          headers: {
            "content-type": "application/x-ndjson",
            "x-session-provider": provider,
            "idempotency-key": selection.idempotencyKey,
          },
          body: selection.file,
        },
      );
      if (!response.ok) {
        setError(await responseError(response));
        return;
      }
      const result = (await response.json()) as { importId: string };
      router.push(
        `/workspaces/${workspaceId}/session-imports?import=${encodeURIComponent(result.importId)}`,
      );
      router.refresh();
    } catch {
      setError("The upload was interrupted. Try again with the same file.");
    } finally {
      setPending(false);
    }
  }

  if (!canUpload) {
    return (
      <p className="text-sm leading-6 text-muted-foreground">
        Workspace editing permission is required to import a session.
      </p>
    );
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void upload(event)}>
      <div className="space-y-2">
        <label
          className="block text-sm font-medium text-foreground"
          htmlFor="session-provider"
        >
          Provider
        </label>
        <select
          id="session-provider"
          className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={provider}
          disabled={pending}
          onChange={(event) => {
            setProvider(event.target.value as typeof provider);
            setSelection(null);
            setError("");
          }}
        >
          <option value="codex">Codex</option>
          <option value="claude" disabled>
            Claude (coming soon)
          </option>
          <option value="cursor" disabled>
            Cursor (coming soon)
          </option>
        </select>
      </div>
      <div className="space-y-2">
        <label
          className="block text-sm font-medium text-foreground"
          htmlFor="source-session-file"
        >
          Codex session file
        </label>
        <input
          accept=".jsonl,application/x-ndjson"
          className="block min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          id="source-session-file"
          type="file"
          disabled={pending}
          aria-describedby={
            error ? "source-file-hint source-file-error" : "source-file-hint"
          }
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            const file = event.target.files?.[0];
            setError("");
            if (!file) {
              setSelection(null);
            } else if (file.size > MAX_SOURCE_BYTES) {
              setSelection(null);
              setError("Choose a session file smaller than 5 MiB.");
            } else {
              setSelection({ file, idempotencyKey: crypto.randomUUID() });
            }
          }}
        />
        <p
          id="source-file-hint"
          className="text-sm leading-6 text-muted-foreground"
        >
          Choose a Codex rollout file named <code>rollout-*.jsonl</code>, up to
          5 MiB. CoDev converts it and opens the imported session for review.
        </p>
        <details className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <summary className="min-h-11 cursor-pointer content-center font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Where is my Codex session file?
          </summary>
          <div className="space-y-2 pb-1 leading-6">
            <p>
              On Windows, paste <code>%USERPROFILE%\.codex\sessions</code> into
              the file picker&apos;s address bar. On macOS or Linux, open{" "}
              <code>~/.codex/sessions</code>; on macOS, press Command–Shift–G in
              the picker to enter the folder path.
            </p>
            <p>
              Open the year, month, and day folders for the session, then choose
              its <code>rollout-*.jsonl</code> file. If you set{" "}
              <code>CODEX_HOME</code>, look in its <code>sessions</code> folder
              instead. <code>history.jsonl</code> is not a session rollout.
            </p>
            <p>
              This first import supports rollouts recorded in a Git repository.
              Review the file for sensitive information before uploading it.
            </p>
          </div>
        </details>
      </div>
      {error ? (
        <p
          id="source-file-error"
          role="alert"
          className="text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      {pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Importing the session…
        </p>
      ) : null}
      <button
        className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-colors motion-reduce:transition-none hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!selection || pending}
        type="submit"
      >
        {pending ? "Importing…" : "Import session"}
      </button>
    </form>
  );
}

export function WorkspaceSessionRestoreActions({
  workspaceId,
  importId,
  status,
  repositoryStatus,
  canRestore,
  sourceProvider,
}: {
  workspaceId: string;
  importId: string;
  status: string;
  repositoryStatus: string;
  canRestore: boolean;
  sourceProvider?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const canAttempt = status === "stored" || status === "restoring";
  const canAcceptTranscriptOnly =
    status === "restoring" &&
    (repositoryStatus === "conflicted" || repositoryStatus === "unavailable");

  async function restore(transcriptOnly: boolean) {
    setPending(true);
    setError("");
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/session-imports/${importId}/restore`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(transcriptOnly ? { transcriptOnly: true } : {}),
        },
      );
      if (!response.ok) {
        setError(await responseError(response));
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the workspace. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (status === "ready") {
    return (
      <p className="text-sm leading-6 text-muted-foreground">
        Repository handling is complete. You will be able to start a fresh CoDev
        continuation or resume the original {sourceProvider ?? "provider"}{" "}
        session with the same provider when native resume is supported. Launch
        controls are coming in a later step.
      </p>
    );
  }
  if (!canAttempt || !canRestore) return null;

  return (
    <div className="space-y-4">
      {pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Updating repository status…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-colors motion-reduce:transition-none hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={pending}
          onClick={() => void restore(false)}
          type="button"
        >
          {pending
            ? "Working…"
            : repositoryStatus === "pending"
              ? "Restore repository"
              : "Retry restoration"}
        </button>
        {canAcceptTranscriptOnly ? (
          <button
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border bg-background px-5 py-2 text-sm font-medium text-foreground transition-colors motion-reduce:transition-none hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pending}
            onClick={() => void restore(true)}
            type="button"
          >
            Continue with transcript only
          </button>
        ) : null}
      </div>
      {canAcceptTranscriptOnly ? (
        <p className="text-sm leading-6 text-muted-foreground">
          Transcript-only skips repository changes from this import. You can
          review the handoff and transcript, but the original files will not be
          restored.
        </p>
      ) : null}
    </div>
  );
}
