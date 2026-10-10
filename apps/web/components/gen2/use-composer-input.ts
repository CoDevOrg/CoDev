"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { useComposerMenu, type ComposerMenuInput } from "./use-composer-menu";
import type { ComposerMentions } from "./use-composer-mentions";
import { useDictation } from "./use-dictation";

type ComposerInput = {
  draft: ComposerMentions;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  connected: boolean;
  onSubmit: () => void;
  /** Loads the last user message into the empty composer; false if none. */
  onRecall: () => boolean;
  onError: (message: string) => void;
  onOverride: ComposerMenuInput["onOverride"];
  menu: Omit<
    ComposerMenuInput,
    "draft" | "textareaRef" | "enabled" | "onOverride" | "onError"
  >;
};

/**
 * Switching chats or losing the connection closes the menu and ends
 * dictation, dropping words still in flight. A chat's first load (or a
 * first turn creating it) is not a switch.
 */
function useComposerReset(
  chatId: string | null,
  connected: boolean,
  dismissMenu: () => void,
  stopDictation: (discard?: boolean) => void,
) {
  const stopRef = useRef(stopDictation);
  useEffect(() => {
    stopRef.current = stopDictation;
  });
  const [chat, setChat] = useState({ id: chatId, switches: 0 });
  if (chat.id !== chatId) {
    const switched = chat.id !== null;
    setChat({ id: chatId, switches: chat.switches + +switched });
    if (switched) dismissMenu();
  }
  useEffect(() => {
    stopRef.current(true);
  }, [chat.switches, connected]);
  return () => stopRef.current(true);
}

function fitHeight(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

/**
 * Grows the field with its text; CSS caps it at 40vh. It also re-measures
 * when its width changes: after a client navigation the first measure can
 * run before the column has its width, wrapping the placeholder tall.
 */
function useAutoGrow(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  text: string,
) {
  useLayoutEffect(() => {
    if (textareaRef.current) fitHeight(textareaRef.current);
  }, [text, textareaRef]);
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    let width = -1;
    const observer = new ResizeObserver(() => {
      if (element.offsetWidth === width) return;
      width = element.offsetWidth;
      fitHeight(element);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [textareaRef]);
}

/**
 * The composer field's behavior: the `/` and `@` menu, dictation into the
 * caret, the hint buttons, and the keys — Enter sends (or picks from the
 * open menu), Up in an empty field recalls the last message, and nothing
 * is taken mid-composition.
 */
export function useComposerInput(props: ComposerInput) {
  const { draft, textareaRef } = props;
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
  const stopDictation = useComposerReset(
    props.menu.chatId,
    props.connected,
    menu.dismiss,
    dictation.stop,
  );
  useAutoGrow(textareaRef, draft.text);

  function insertText(insert: string) {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? draft.text.length;
    const before = draft.text.slice(0, start);
    const spaced = before && !/\s$/.test(before) ? ` ${insert}` : insert;
    const end = element?.selectionEnd ?? start;
    draft.setText(before + spaced + draft.text.slice(end));
    menu.placeCaret(start + spaced.length);
  }

  function insertTrigger(trigger: "/" | "@") {
    if (trigger === "@") insertText("@");
    // Commands only work at the start of the prompt.
    else if (!draft.text.startsWith("/")) draft.setText(`/${draft.text}`);
    if (trigger === "/") menu.placeCaret(1);
    textareaRef.current?.focus();
  }

  function submit() {
    stopDictation();
    if (!menu.intercept(draft.text)) props.onSubmit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (menu.handleKey(event)) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const recall =
      event.key === "ArrowUp" &&
      !draft.text &&
      event.currentTarget.selectionStart === 0;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    } else if (recall && props.onRecall()) event.preventDefault();
  }

  return { menu, dictation, insertTrigger, submit, onKeyDown };
}
