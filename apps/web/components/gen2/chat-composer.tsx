"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { Gen2AgentProviderName } from "@codev/contracts";

import { parseGen2PromptCommand } from "@/lib/gen2/prompt-command";
import { ChatComposerChips } from "./chat-composer-chips";
import { ChatComposerHints } from "./chat-composer-hints";
import { ChatComposerToolbar } from "./chat-composer-toolbar";
import { ChatDictationStatus } from "./chat-dictation-status";
import { ChatTypeaheadMenu, composerOptionId } from "./chat-typeahead-menu";
import type { ChatAttachment } from "./use-chat-attachments";
import { useComposerDrop } from "./use-composer-drop";
import { useComposerMenu, type ComposerMenuInput } from "./use-composer-menu";
import type { ComposerMentions } from "./use-composer-mentions";
import { useDictation } from "./use-dictation";

export const MAX_COMPOSER_CHARS = 20_000;

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

/**
 * The chat composer: one field with its context chips, the `/` and `@`
 * menu, dictation, attachments and the agent picker. Typing stays allowed
 * while a turn runs; Enter then queues one follow-up.
 */
export function ChatComposer(props: ChatComposerProps) {
  const { draft, textareaRef } = props;
  const listboxId = useId();
  const menu = useComposerMenu({
    ...props.menu,
    draft,
    textareaRef,
    enabled: props.connected,
    onOverride: props.onOverride,
    onError: props.onError,
  });
  const dictation = useDictation({
    onFinal: insertText,
    onError: props.onError,
  });
  const drop = useComposerDrop(props.onQueueFiles);
  const stopDictation = useRef(dictation.stop);
  useEffect(() => {
    stopDictation.current = dictation.stop;
  });
  // Switching chats or losing the connection ends dictation and the menu.
  // A chat's first load (or a first turn creating it) is not a switch.
  const [chat, setChat] = useState({ id: props.menu.chatId, switches: 0 });
  if (chat.id !== props.menu.chatId) {
    const switched = chat.id !== null;
    setChat({ id: props.menu.chatId, switches: chat.switches + +switched });
    if (switched) menu.dismiss();
  }
  useEffect(() => {
    stopDictation.current(true);
  }, [chat.switches, props.connected]);

  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [draft.text, textareaRef]);

  function insertText(insert: string) {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? draft.text.length;
    const before = draft.text.slice(0, start);
    const spaced = before && !/\s$/.test(before) ? ` ${insert}` : insert;
    draft.setText(
      before + spaced + draft.text.slice(element?.selectionEnd ?? start),
    );
    menu.placeCaret(start + spaced.length);
  }

  function insertTrigger(trigger: "/" | "@") {
    if (trigger === "@") insertText("@");
    else {
      draft.setText(`/${draft.text}`);
      menu.placeCaret(1);
    }
    textareaRef.current?.focus();
  }

  function submit() {
    stopDictation.current(true);
    if (menu.intercept(draft.text)) return;
    props.onSubmit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (menu.handleKey(event)) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    } else if (
      event.key === "ArrowUp" &&
      !draft.text &&
      event.currentTarget.selectionStart === 0 &&
      props.onRecall()
    ) {
      event.preventDefault();
    }
  }

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
            submit();
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
          <textarea
            ref={textareaRef}
            value={draft.text}
            maxLength={MAX_COMPOSER_CHARS}
            rows={props.hero ? 3 : 2}
            className="gen2-chat-composer-input"
            aria-label="Prompt"
            aria-autocomplete="list"
            aria-controls={menu.open ? listboxId : undefined}
            aria-activedescendant={
              menu.open
                ? composerOptionId(listboxId, menu.activeIndex)
                : undefined
            }
            placeholder={placeholder(
              drop.dragging,
              props.running,
              props.agentLabel,
            )}
            onChange={(event) => {
              draft.setText(event.target.value);
              menu.setCaret(
                event.target.selectionStart ?? event.target.value.length,
              );
            }}
            onSelect={(event) =>
              menu.setCaret(event.currentTarget.selectionStart ?? 0)
            }
            onKeyDown={onKeyDown}
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
        onInsert={insertTrigger}
      />
    </div>
  );
}
