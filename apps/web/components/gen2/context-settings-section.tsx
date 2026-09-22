"use client";

import { useEffect, useState } from "react";
import type {
  Gen2ChatDetail,
  Gen2ContextPreview,
  Gen2WorkspaceCapabilities,
} from "@codev/contracts";
import { AlertCircle, LoaderCircle } from "lucide-react";

type PreviewResponse = { context?: Gen2ContextPreview; error?: string };
type ChatResponse = { chat?: Gen2ChatDetail; error?: string };

export function Gen2ContextSettingsSection({
  workspaceId,
  chatId,
  capabilities,
}: {
  workspaceId: string;
  chatId: string | null;
  capabilities: Gen2WorkspaceCapabilities;
}) {
  const [result, setResult] = useState<{
    key: string;
    preview: Gen2ContextPreview | null;
    messages: Gen2ChatDetail["messages"];
    error: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const requestKey =
    chatId && capabilities["context.view"]
      ? `${workspaceId}:${chatId}:${retry}`
      : null;

  useEffect(() => {
    let active = true;
    if (!requestKey || !chatId) return;
    const base = `/api/gen2/workspaces/${workspaceId}/chats/${chatId}`;
    Promise.all([
      fetch(`${base}/context-preview`).then(async (response) => {
        const payload = (await response
          .json()
          .catch(() => ({}))) as PreviewResponse;
        if (!response.ok || !payload.context) {
          throw new Error(
            payload.error ?? "Could not load the context preview.",
          );
        }
        return payload.context;
      }),
      fetch(base).then(async (response) => {
        const payload = (await response
          .json()
          .catch(() => ({}))) as ChatResponse;
        if (!response.ok || !payload.chat) {
          throw new Error(payload.error ?? "Could not load chat messages.");
        }
        return payload.chat.messages;
      }),
    ])
      .then(([nextPreview, nextMessages]) => {
        if (!active) return;
        setResult({
          key: requestKey,
          preview: nextPreview,
          messages: nextMessages,
          error: "",
        });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setResult({
          key: requestKey,
          preview: null,
          messages: [],
          error:
            cause instanceof Error
              ? cause.message
              : "Could not load the context preview.",
        });
      });

    return () => {
      active = false;
    };
  }, [workspaceId, chatId, requestKey]);

  const activeResult = requestKey && result?.key === requestKey ? result : null;
  const activePreview = activeResult?.preview ?? null;
  const loading = requestKey !== null && activeResult === null;
  const previewMessages = activePreview
    ? activePreview.messageIds
        .map((id) =>
          activeResult?.messages.find((message) => message.id === id),
        )
        .filter((message) => message !== undefined)
    : [];

  return (
    <section
      aria-labelledby="gen2-context-settings-title"
      className="gen2-context-settings"
    >
      <div className="gen2-context-header">
        <div>
          <h3 id="gen2-context-settings-title">Context</h3>
          <p>What the agent receives and can access during each turn.</p>
        </div>
      </div>

      <div className="gen2-context-sources">
        <article>
          <h4>Chat transcript</h4>
          <p>
            {capabilities["context.includeInTurn"]
              ? `Up to ${activePreview?.maxMessages ?? 20} previous messages from this chat are included, capped at ${(
                  (activePreview?.maxCharacters ?? 12_000) / 1000
                ).toLocaleString()}k characters. Your new prompt is added separately.`
              : "Your current workspace capability does not allow the transcript to be included in agent turns."}
          </p>
        </article>
        <article>
          <h4>Repository</h4>
          <p>
            The agent runs in the workspace at <code>/workspace</code> and can
            inspect the current repository as needed. A repository snapshot is
            not copied into the chat transcript.
          </p>
        </article>
        <article>
          <h4>Terminal and files</h4>
          <p>
            Terminal output and file contents are not attached automatically.
            The agent can use the workspace machine to inspect or change files
            while carrying out your request.
          </p>
        </article>
      </div>

      <div className="gen2-context-policy" role="note">
        <strong>Context policy</strong>
        <p>
          {capabilities["workspace.managePolicy"]
            ? "You have permission to manage workspace policy. Configurable context-policy controls are not available yet."
            : "Only members with the workspace.managePolicy capability can change workspace policy. Context-policy controls are not available yet."}
        </p>
      </div>

      <div className="gen2-context-preview" aria-live="polite">
        <div className="gen2-context-preview-heading">
          <div>
            <h4>Transcript preview</h4>
            <p>
              {chatId
                ? "The previous messages selected for the next turn in this chat."
                : "Start a chat to preview its transcript context."}
            </p>
          </div>
          {activePreview ? (
            <span className="gen2-context-count">
              {activePreview.messageCount} / {activePreview.maxMessages}{" "}
              messages
            </span>
          ) : null}
        </div>

        {!capabilities["context.view"] ? (
          <p className="gen2-context-state">
            Your workspace role does not allow viewing transcript context.
          </p>
        ) : !chatId ? (
          <p className="gen2-context-state">
            No chat is selected, so there are no previous messages to include.
          </p>
        ) : loading ? (
          <p className="gen2-context-state" role="status" aria-busy="true">
            <LoaderCircle aria-hidden="true" size={16} /> Loading preview…
          </p>
        ) : activeResult?.error ? (
          <div className="gen2-context-error" role="alert">
            <AlertCircle aria-hidden="true" size={16} />
            <span>{activeResult.error}</span>
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry
            </button>
          </div>
        ) : activePreview?.messageCount === 0 ? (
          <p className="gen2-context-state">
            No previous messages yet. The next turn will include only its new
            prompt.
          </p>
        ) : (
          <ol className="gen2-context-message-list">
            {previewMessages.map((message) => (
              <li key={message.id}>
                <span>{message.role === "user" ? "You" : "Assistant"}</span>
                <p>{message.body}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
