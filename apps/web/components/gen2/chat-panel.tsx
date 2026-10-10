"use client";

import { useMemo, useRef, useState } from "react";
import {
  GEN2_AGENT_PROVIDERS,
  type Gen2PossibleDuplicateTask,
} from "@codev/contracts";

import { TooltipProvider } from "@/components/ui/tooltip";
import { deriveGen2ChatGoal } from "@/lib/gen2/chat-goal";
import { ChatAgentPicker } from "./chat-agent-picker";
import { ChatComposer } from "./chat-composer";
import { rankChatEmptyCards } from "./chat-empty-cards";
import { CHAT_VIEWER_COPY, ChatEmptyState } from "./chat-empty-state";
import { ChatGoalBar } from "./chat-goal-bar";
import { ChatNotices } from "./chat-notices";
import { ChatPanelBar } from "./chat-panel-bar";
import { ChatTranscript } from "./chat-transcript";
import { Gen2ConnectProvider } from "./connect-provider";
import { useChatDraft } from "./use-chat-draft";
import { useChatSession, type ChatSessionInput } from "./use-chat-session";
import type { ChatTurnOutcome } from "./use-chat-turn";
import {
  GOAL_CONTINUE_PROMPT,
  useGoalContinuation,
} from "./use-goal-continuation";
import { useWorkspaceActionDispatch } from "./use-workspace-action-dispatch";
import { WorkspaceActionCards } from "./workspace-action-cards";
import { useWorkspaceAgent } from "./workspace-controller";

export type Gen2ChatPanelProps = Omit<
  ChatSessionInput,
  | "agentContext"
  | "transcriptRef"
  | "setError"
  | "setPossibleDuplicate"
  | "onSettled"
> & {
  onOpenFile: (path: string) => void;
  hideChatBar?: boolean | undefined;
  onOpenWorktree?: ((worktreeId: string) => void) | undefined;
  /** Opens the workspace's settings so an account connects in place. */
  onOpenSettings?: (() => void) | undefined;
  /** The workspace connection is up; without it the menu and mic close. */
  connected?: boolean | undefined;
};

export function Gen2ChatPanel(props: Gen2ChatPanelProps) {
  const { workspace, onOpenFile, onOpenWorktree, onOpenSettings } = props;
  const connected = props.connected ?? true;
  const agentContext = useWorkspaceAgent();
  const canEdit =
    workspace.role !== "viewer" && (agentContext?.canEdit ?? true);
  const [error, setError] = useState("");
  const [possibleDuplicate, setPossibleDuplicate] =
    useState<Gen2PossibleDuplicateTask | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const session = useChatSession({
    ...props,
    agentContext,
    transcriptRef,
    setError,
    setPossibleDuplicate,
    onSettled,
  });
  const { models, thread, turn, scroll, sender, busy, modelFor } = session;
  const { agent, agentLabel, provider } = models;
  const { chatId } = thread;
  const messages = thread.thread.messages;
  const goal = useMemo(() => deriveGen2ChatGoal(messages), [messages]);
  const draft = useChatDraft({
    send: sender.send,
    busy,
    modelReady: (choice) => Boolean(modelFor(choice)),
    switchingChat: thread.switchingChat,
    agentContext,
    textareaRef,
    setError,
  });
  const continuation = useGoalContinuation({
    goal,
    chatId,
    connected,
    onContinue: () => sendText(GOAL_CONTINUE_PROMPT),
  });
  const dispatch = useWorkspaceActionDispatch({
    workspaceId: workspace.id,
    chatId,
    live: turn.live,
  });
  const empty = messages.length === 0 && !busy && !thread.switchingChat;
  const { override } = draft;

  function onSettled(outcome: ChatTurnOutcome) {
    continuation.onSettled(outcome);
    draft.onSettled(outcome);
  }

  function sendText(prompt: string) {
    void sender.send({
      text: prompt,
      mentions: [],
      attachments: [],
      override: null,
    });
  }

  const notices = (
    <ChatNotices
      duplicate={possibleDuplicate}
      members={workspace.members}
      onOpenDuplicate={
        onOpenWorktree &&
        ((id) => {
          onOpenWorktree(id);
          setPossibleDuplicate(null);
          textareaRef.current?.focus();
        })
      }
      onStartAnyway={(runId) => {
        sender.acknowledgeDuplicate(runId);
        setPossibleDuplicate(null);
        draft.submit();
      }}
      onDismissDuplicate={() => {
        setPossibleDuplicate(null);
        textareaRef.current?.focus();
      }}
      error={error}
      modelsError={provider?.modelsError}
      onRetryModels={() => void models.refreshProvider()}
      onDismissError={() => setError("")}
    />
  );
  const overrideLabel = `${GEN2_AGENT_PROVIDERS.find((entry) => entry.id === override)?.label} · ${modelFor(override)?.label ?? "default model"}`;
  const composer = canEdit ? (
    <ChatComposer
      draft={draft.text}
      textareaRef={textareaRef}
      attachments={draft.files.attachments}
      onQueueFiles={draft.files.queueFiles}
      onRemoveAttachment={draft.files.removeAttachment}
      override={override ? { provider: override, label: overrideLabel } : null}
      onOverride={draft.setOverride}
      queued={draft.queued}
      onCancelQueued={draft.cancelQueued}
      agentPicker={<ChatAgentPicker models={models} disabled={busy} />}
      agentLabel={agentLabel}
      hero={empty}
      running={turn.running}
      canSend={
        Boolean(draft.text.text.trim() || draft.files.attachments.length) &&
        !busy &&
        Boolean(modelFor(override))
      }
      connected={connected}
      onSubmit={draft.submit}
      onStop={() => void turn.stop()}
      onRecall={() => draft.recall(messages)}
      onError={setError}
      menu={{
        agentContext,
        workspaceId: workspace.id,
        chatId,
        messages,
        agent,
        connectedProviders: models.availableProviders,
        canEdit,
        hasGoal: goal !== null,
        onSendText: sendText,
        onOpenSettings,
      }}
    />
  ) : null;

  return (
    <TooltipProvider delayDuration={300}>
      <section className="gen2-chat-panel" aria-label="Agent chat">
        {!props.hideChatBar ? (
          <ChatPanelBar
            chats={thread.chats}
            chatId={chatId}
            providers={models.availableProviders}
            onNewChat={(choice) => void session.newChat(choice)}
            onSelect={(id) => {
              thread.setChatId(id);
              props.onSelectChatId?.(id);
              scroll.pinToLatest();
            }}
          />
        ) : null}
        {empty ? (
          <ChatEmptyState
            agentLabel={agentLabel}
            viewer={!canEdit}
            connected={models.availableProviders.includes(agent)}
            workspaceAware={agentContext !== null}
            previewEnabled={agentContext?.previewEnabled ?? false}
            cards={rankChatEmptyCards(
              agentContext,
              chatId,
              workspace.members.length,
            )}
            onCard={(card) => draft.fill(card.text)}
            composer={
              <>
                {composer}
                {notices}
              </>
            }
            connect={
              provider !== null && !provider.connected ? (
                <Gen2ConnectProvider
                  agent={agent}
                  onConnected={() => void models.refreshProvider()}
                  onOpenSettings={onOpenSettings}
                />
              ) : null
            }
          />
        ) : (
          <div className="gen2-chat-filled">
            <ChatTranscript
              transcriptRef={transcriptRef}
              onScroll={scroll.onScroll}
              showJump={scroll.showJump}
              onJump={scroll.jumpToLatest}
              importedFrom={thread.importedFrom}
              chatId={chatId}
              messages={messages}
              live={
                turn.running || sender.starting
                  ? {
                      items: turn.items,
                      reply: turn.liveReply,
                      starting:
                        sender.starting &&
                        !turn.running &&
                        !messages.some(
                          (message) => message.role === "assistant",
                        ),
                      actionToken: turn.liveActionNonce,
                    }
                  : null
              }
              onOpenFile={onOpenFile}
              nextSteps={
                canEdit && !busy
                  ? { onSend: sendText, onRefine: () => draft.fill("/plan ") }
                  : null
              }
            />
            <div className="gen2-chat-dock">
              <WorkspaceActionCards
                pending={dispatch.pending}
                onResolve={dispatch.resolve}
              />
              {notices}
              {goal ? (
                <ChatGoalBar
                  goal={goal}
                  canEdit={canEdit}
                  busy={busy}
                  continuation={continuation}
                  onSend={sendText}
                />
              ) : null}
              {composer ?? (
                <p className="gen2-chat-viewer">{CHAT_VIEWER_COPY}</p>
              )}
            </div>
          </div>
        )}
        <div className="gen2-composer-sr-only" aria-live="polite">
          {dispatch.announcement}
        </div>
      </section>
    </TooltipProvider>
  );
}
