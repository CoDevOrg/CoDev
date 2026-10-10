"use client";

import { useId, type ReactNode, type RefObject } from "react";
import type { Gen2AgentProviderName } from "@codev/contracts";

import { parseGen2PromptCommand } from "@/lib/gen2/prompt-command";
import { ChatComposerChips } from "./chat-composer-chips";
import { ChatComposerHints } from "./chat-composer-hints";
import { ChatComposerToolbar } from "./chat-composer-toolbar";
import { ChatDictationStatus } from "./chat-dictation-status";
import { ChatTypeaheadMenu, composerOptionId } from "./chat-typeahead-menu";
import type { ChatAttachment } from "./use-chat-attachments";
import { useComposerDrop } from "./use-composer-drop";
import { useComposerInput } from "./use-composer-input";
import type { ComposerMenu, ComposerMenuInput } from "./use-composer-menu";
import {
  MAX_PROMPT_CHARS,
  type ComposerMentions,
} from "./use-composer-mentions";

export type ChatComposerProps = {
  draft: ComposerMentions;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  attachments: ChatAttachment[];
  onQueueFiles: (files: FileList | File[] | null) => void;
  onRemoveAttachment: (id: string) => void;
  /** This message's agent, when it differs from the chat's. */
  override: { provider: Gen2AgentProviderName; label: string } | null;
  onOverride: (provider: Gen2AgentProviderName | null) => void;
  queued: boolean;
  onCancelQueued: () => void;
  agentPicker: ReactNode;
  agentLabel: string;
  /** The empty-state composer: taller, and its menu opens downward. */
  hero: boolean;
  running: boolean;
  canSend: boolean;
  connected: boolean;
  onSubmit: () => void;
  onStop: () => void;
  /** Loads the last user message into the empty composer; false if none. */
  onRecall: () => boolean;
  onError: (message: string) => void;
  menu: Omit<
    ComposerMenuInput,
    "draft" | "textareaRef" | "enabled" | "onOverride" | "onError"
  >;
};

function placeholder(dragging: boolean, running: boolean, agent: string) {
  if (dragging) return "Drop files to attach to this turn…";
  if (running) return `${agent} is working — Enter queues a follow-up`;
  return "Ask anything — / for commands, @ to mention";
}

type FieldProps = Pick<
  ChatComposerProps,
  "draft" | "textareaRef" | "hero" | "running" | "agentLabel"
> & {
  menu: ComposerMenu;
  listboxId: string;
  dragging: boolean;
  onKeyDown: ReturnType<typeof useComposerInput>["onKeyDown"];
};

/** The prompt field, which drives the menu through aria-activedescendant. */
function ComposerField({
  draft,
  textareaRef,
  hero,
  running,
  agentLabel,
  menu,
  listboxId,
  dragging,
  onKeyDown,
}: FieldProps) {
  return (
    <textarea
      ref={textareaRef}
      value={draft.text}
      maxLength={MAX_PROMPT_CHARS}
      rows={hero ? 3 : 2}
      className="gen2-chat-composer-input"
      aria-label="Prompt"
      aria-autocomplete="list"
      aria-controls={menu.open ? listboxId : undefined}
      aria-activedescendant={
        menu.open ? composerOptionId(listboxId, menu.activeIndex) : undefined
      }
      placeholder={placeholder(dragging, running, agentLabel)}
      onChange={(event) => {
        draft.setText(event.target.value);
        menu.setCaret(event.target.selectionStart ?? event.target.value.length);
      }}
      onSelect={(event) =>
        menu.setCaret(event.currentTarget.selectionStart ?? 0)
      }
      onKeyDown={onKeyDown}
    />
  );
}

/**
 * The chat composer: one field with its context chips, the `/` and `@`
 * menu, dictation, attachments and the agent picker. Typing stays allowed
 * while a turn runs; Enter then queues one follow-up.
 */
export function ChatComposer(props: ChatComposerProps) {
  const { draft } = props;
  const listboxId = useId();
  const { menu, dictation, ...input } = useComposerInput(props);
  const drop = useComposerDrop(props.onQueueFiles);

  return (
    <div className="gen2-chat-composer-wrap">
      <ChatTypeaheadMenu
        open={menu.open}
        side={props.hero ? "bottom" : "top"}
        label={menu.trigger?.kind === "mention" ? "Mentions" : "Commands"}
        listboxId={listboxId}
        items={menu.items}
        activeIndex={menu.activeIndex}
        onSelect={menu.select}
        onActiveChange={menu.setActiveIndex}
        onDismiss={menu.dismiss}
      >
        <form
          className="gen2-chat-composer"
          data-dragging={drop.dragging || undefined}
          onSubmit={(event) => {
            event.preventDefault();
            input.submit();
          }}
          {...drop.handlers}
        >
          <ChatComposerChips
            command={parseGen2PromptCommand(draft.text).command}
            onRemoveCommand={() =>
              draft.setText(draft.text.replace(/^\/[a-z]+\s*/i, ""))
            }
            override={props.override}
            onRemoveOverride={() => props.onOverride(null)}
            mentions={draft.mentions}
            onRemoveMention={draft.removeMention}
            attachments={props.attachments}
            onRemoveAttachment={props.onRemoveAttachment}
            queued={props.queued}
            onCancelQueued={props.onCancelQueued}
          />
          <ComposerField
            draft={draft}
            textareaRef={props.textareaRef}
            hero={props.hero}
            running={props.running}
            agentLabel={props.agentLabel}
            menu={menu}
            listboxId={listboxId}
            dragging={drop.dragging}
            onKeyDown={input.onKeyDown}
          />
          <ChatDictationStatus dictation={dictation} />
          <ChatComposerToolbar
            agentPicker={props.agentPicker}
            dictation={dictation}
            running={props.running}
            canSend={props.canSend}
            agentLabel={props.agentLabel}
            onFiles={props.onQueueFiles}
            onStop={props.onStop}
          />
        </form>
      </ChatTypeaheadMenu>
      <ChatComposerHints
        triggered={menu.open}
        dictation={dictation.supported}
        onInsert={input.insertTrigger}
      />
    </div>
  );
}
