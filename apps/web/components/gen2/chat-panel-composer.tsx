"use client";

import { GEN2_AGENT_PROVIDERS } from "@codev/contracts";

import { ChatAgentPicker } from "./chat-agent-picker";
import { ChatComposer } from "./chat-composer";
import type { ChatPanelState } from "./use-chat-panel";

/** The panel's composer, bound to its draft, agent and live turn. */
export function ChatPanelComposer({
  panel,
  onOpenSettings,
}: {
  panel: ChatPanelState;
  onOpenSettings: (() => void) | undefined;
}) {
  const { draft, models, busy, modelFor, workspace } = panel;
  const { override } = draft;
  const overrideAgent = GEN2_AGENT_PROVIDERS.find(
    (entry) => entry.id === override,
  )?.label;
  const filled = draft.text.text.trim() || draft.files.attachments.length;
  return (
    <ChatComposer
      draft={draft.text}
      textareaRef={panel.textareaRef}
      attachments={draft.files.attachments}
      onQueueFiles={draft.files.queueFiles}
      onRemoveAttachment={draft.files.removeAttachment}
      override={
        override
          ? {
              provider: override,
              label: `${overrideAgent} · ${modelFor(override)?.label ?? "default model"}`,
            }
          : null
      }
      onOverride={draft.setOverride}
      queued={draft.queued}
      onCancelQueued={draft.cancelQueued}
      agentPicker={<ChatAgentPicker models={models} disabled={busy} />}
      agentLabel={models.agentLabel}
      hero={panel.empty}
      running={panel.turn.running}
      canSend={Boolean(filled) && !busy && Boolean(modelFor(override))}
      connected={panel.connected}
      onSubmit={draft.submit}
      onStop={() => void panel.turn.stop()}
      onRecall={() => draft.recall(panel.messages)}
      onError={panel.setError}
      menu={{
        agentContext: panel.agentContext,
        workspaceId: workspace.id,
        repositoryPrivate: workspace.repository?.private ?? false,
        chatId: panel.thread.chatId,
        messages: panel.messages,
        agent: models.agent,
        connectedProviders: models.availableProviders,
        canEdit: panel.canEdit,
        hasGoal: panel.goal !== null,
        onSendText: panel.sendText,
        onOpenSettings,
      }}
    />
  );
}
