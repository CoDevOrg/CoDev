"use client";

import { useState, type ChangeEvent } from "react";
import { X } from "lucide-react";

import type { CodevBridgeCommand } from "@/components/codev-parent-bridge";

type ImportState = "idle" | "reading" | "error" | "done";

type ImportResult = {
  sessionId: string;
  resumeCommand: string;
};

async function readErrorMessage(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return payload?.error ?? "The upload failed.";
}

export function WorkspaceCodexResumeDialog({
  open,
  onClose,
  workspaceId,
  onResumeCommand,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  /** Sends the resume command into the embedded IDE's own terminal. Returns
   *  false when the IDE isn't connected yet, in which case the dialog falls
   *  back to a manual copy-paste command instead. */
  onResumeCommand: (command: CodevBridgeCommand) => boolean;
}) {
  const [state, setState] = useState<ImportState>("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [launched, setLaunched] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setState("reading");
    setMessage("");
    setResult(null);
    setLaunched(false);
    setCopied(false);
    try {
      const contents = await file.text();
      const response = await fetch(
        `/api/workspaces/${workspaceId}/codex-session-import`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contents }),
        },
      );
      if (!response.ok) {
        setMessage(await readErrorMessage(response));
        setState("error");
        return;
      }
      const payload = (await response.json()) as ImportResult;
      setResult(payload);
      setLaunched(
        onResumeCommand({
          kind: "terminal-run",
          command: payload.resumeCommand,
          label: "Resume Codex session",
          agent: "codex",
        }),
      );
      setState("done");
    } catch {
      setMessage("Could not read or upload that file.");
      setState("error");
    }
  }

  function reset() {
    setState("idle");
    setMessage("");
    setResult(null);
    setLaunched(false);
    setCopied(false);
  }

  if (!open) return null;

  return (
    <div
      className="workspace-create-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && state !== "reading") {
          reset();
          onClose();
        }
      }}
    >
      <section
        className="workspace-create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-codex-resume-title"
      >
        <div className="workspace-create-heading">
          <div>
            <p className="eyebrow">Codex</p>
            <h2 id="workspace-codex-resume-title">Resume a local session</h2>
            <p>
              Upload a Codex rollout file from your own machine (found under{" "}
              <code>~/.codex/sessions</code>) to bring that conversation into
              this workspace.
            </p>
          </div>
          <button
            className="modal-close-button"
            type="button"
            aria-label="Close"
            disabled={state === "reading"}
            onClick={() => {
              reset();
              onClose();
            }}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        {state !== "done" ? (
          <div className="picker-grid">
            <label>
              <span>Rollout file (.jsonl)</span>
              <input
                type="file"
                accept=".jsonl,application/jsonl,application/x-jsonlines"
                disabled={state === "reading"}
                onChange={(event) => void handleFile(event)}
              />
            </label>
          </div>
        ) : null}

        {state === "reading" ? (
          <p className="panel-status">Uploading and placing the session…</p>
        ) : null}
        {state === "error" ? (
          <p className="panel-status error-copy">{message}</p>
        ) : null}

        {state === "done" && result && launched ? (
          <div className="picker-grid">
            <p className="panel-status">
              Imported. Opening the resumed chat in a new terminal tab…
            </p>
          </div>
        ) : null}

        {state === "done" && result && !launched ? (
          <div className="picker-grid">
            <p className="panel-status">
              Imported, but the IDE isn&apos;t connected yet. Open a terminal
              tab and run:
            </p>
            <div className="workspace-create-blank" style={{ cursor: "text" }}>
              <code>{result.resumeCommand}</code>
            </div>
            <button
              className="workspace-topbar-share"
              type="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(result.resumeCommand)
                  .then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy command"}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
