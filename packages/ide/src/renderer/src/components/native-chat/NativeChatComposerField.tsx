import type {
  ClipboardEventHandler,
  CompositionEventHandler,
  KeyboardEventHandler,
  RefObject
} from 'react'
import { Image as ImageIcon, ImageOff, X } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { NATIVE_FILE_DROP_TARGET } from '../../../../shared/native-file-drop'
import { basename } from '@/lib/path'
import { isNativeChatPastedImagePath } from './native-chat-image-paste'
import type { ComposerAutocomplete, NativeChatPickerItem } from './native-chat-composer-state'
import { NativeChatMentionHint, NativeChatPickerMenu } from './NativeChatAutocompleteMenus'
import { NativeChatComposerActions } from './NativeChatComposerActions'
import { nativeChatComposerPlaceholder } from './native-chat-composer-target'
import { useCodevAgentSendGate } from '@/web/codev-provider-readiness'
import type {
  SessionOptionDescriptor,
  SessionOptionsSurface
} from '../../../../shared/native-chat-session-options'
import type { AgentType } from '../../../../shared/agent-status-types'

export type NativeChatComposerFieldProps = {
  agent: AgentType
  terminalTabId: string
  textareaRef: RefObject<HTMLTextAreaElement | null>
  draft: string
  disabled: boolean
  hasPty: boolean
  canSend: boolean
  autocomplete: ComposerAutocomplete
  activeSuggestion: number
  notice: string | null
  imageAttachments: readonly NativeChatComposerImageAttachment[]
  sendButtonDisabled: boolean
  isWorking: boolean
  attachDisabled: boolean
  onDraftChange: (value: string, element: HTMLTextAreaElement) => void
  onTextareaSelect: (element: HTMLTextAreaElement) => void
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>
  onCompositionStart: CompositionEventHandler<HTMLTextAreaElement>
  onCompositionEnd: CompositionEventHandler<HTMLTextAreaElement>
  onPaste: ClipboardEventHandler<HTMLTextAreaElement>
  pickerListboxId: string
  onChoosePickerItem: (item: NativeChatPickerItem) => void
  onRetrySkills: () => void
  onAcceptMention: () => void
  onRemoveImageAttachment: (id: string) => void
  onAttach: () => void
  onSend: () => void
  onStop?: () => void
  sessionOptionsSurface: SessionOptionsSurface | null
  sessionOptionsSnapshot: SessionOptionDescriptor[]
}

export type NativeChatComposerImageAttachment = {
  id: string
  path: string
}

export function NativeChatComposerField({
  textareaRef,
  draft,
  disabled,
  hasPty,
  canSend,
  autocomplete,
  activeSuggestion,
  notice,
  imageAttachments,
  sendButtonDisabled,
  isWorking,
  attachDisabled,
  onDraftChange,
  onTextareaSelect,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  onPaste,
  pickerListboxId,
  onChoosePickerItem,
  onRetrySkills,
  onAcceptMention,
  onRemoveImageAttachment,
  onAttach,
  onSend,
  onStop,
  sessionOptionsSurface,
  sessionOptionsSnapshot,
  agent,
  terminalTabId
}: NativeChatComposerFieldProps): React.JSX.Element {
  const sendGate = useCodevAgentSendGate()
  return (
    <div className="shrink-0 bg-background">
      {/* Extra bottom padding keeps the input box off the window rim. */}
      <div className="px-4 pt-2 pb-5 sm:px-6">
        <div className="relative mx-auto w-full max-w-3xl">
          {autocomplete.mode === 'slash' || autocomplete.mode === 'skill' ? (
            <NativeChatPickerMenu
              autocomplete={autocomplete}
              activeIndex={activeSuggestion}
              listboxId={pickerListboxId}
              onChoose={onChoosePickerItem}
              onRetry={onRetrySkills}
            />
          ) : null}
          {autocomplete.mode === 'mention' ? (
            <NativeChatMentionHint query={autocomplete.query} onAccept={onAcceptMention} />
          ) : null}
          {notice ? (
            <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <ImageOff className="size-3.5 shrink-0" />
              <span>{notice}</span>
            </div>
          ) : null}
          <div
            data-codev-chat-composer="true"
            data-native-file-drop-target={NATIVE_FILE_DROP_TARGET.composer}
            className={cn(
              'rounded-[18px] border border-border bg-card p-2 shadow-sm',
              'transition-[border-color,box-shadow] duration-200',
              'focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/15'
            )}
          >
            {imageAttachments.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-1.5 px-1">
                {imageAttachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground"
                    title={attachment.path}
                  >
                    <ImageIcon className="size-3.5 shrink-0" />
                    <span className="max-w-56 truncate">
                      {isNativeChatPastedImagePath(attachment.path)
                        ? translate(
                            'components.native-chat.composer.pastedImageLabel',
                            'Pasted image'
                          )
                        : basename(attachment.path)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveImageAttachment(attachment.id)}
                      aria-label={translate(
                        'components.native-chat.composer.removeAttachment',
                        'Remove attachment'
                      )}
                      className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <textarea
              ref={textareaRef}
              value={draft}
              disabled={disabled}
              rows={2}
              // Why: writing-assistant extensions overlay their badge on the placeholder and action row.
              data-gramm="false"
              data-gramm_editor="false"
              data-enable-grammarly="false"
              onChange={(e) => onDraftChange(e.target.value, e.currentTarget)}
              onKeyDown={onKeyDown}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
              onPaste={onPaste}
              onSelect={(e) => onTextareaSelect(e.currentTarget)}
              aria-expanded={autocomplete.mode === 'slash' || autocomplete.mode === 'skill'}
              aria-controls={
                autocomplete.mode === 'slash' || autocomplete.mode === 'skill'
                  ? pickerListboxId
                  : undefined
              }
              aria-activedescendant={
                (autocomplete.mode === 'slash' || autocomplete.mode === 'skill') &&
                autocomplete.items.length > 0
                  ? `${pickerListboxId}-option-${Math.min(activeSuggestion, autocomplete.items.length - 1)}`
                  : undefined
              }
              placeholder={nativeChatComposerPlaceholder(hasPty, canSend, sendGate.reason)}
              // Why: coarse-pointer min-height follows the app's touch target convention.
              // field-sizing:content grows the field with the draft; the 8lh cap (plus
              // py-1) turns further growth into internal scrolling, and scrollbar-sleek
              // keeps that gutter off the heavy native scrollbar. Both are layout-driven,
              // so re-wrap on window/pane resize is handled without a measure pass.
              className={cn(
                'scrollbar-sleek min-h-12 w-full resize-none bg-transparent px-2 py-1 text-[15px] leading-6 outline-none pointer-coarse:min-h-14',
                '[field-sizing:content] max-h-[calc(8lh+0.5rem)]',
                'placeholder:text-muted-foreground/60 disabled:cursor-not-allowed disabled:opacity-50'
              )}
            />
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <NativeChatComposerActions
                agent={agent}
                terminalTabId={terminalTabId}
                attachDisabled={attachDisabled}
                sendDisabled={sendButtonDisabled}
                isWorking={isWorking}
                onAttach={onAttach}
                onSend={onSend}
                onStop={onStop}
                sessionOptionsSurface={sessionOptionsSurface}
                sessionOptionsSnapshot={sessionOptionsSnapshot}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
