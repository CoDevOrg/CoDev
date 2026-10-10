"use client";

import type { ReactNode } from "react";
import {
  Bot,
  FileText,
  Folder,
  MessageSquare,
  SquareTerminal,
  TextCursorInput,
  X,
} from "lucide-react";
import type { Gen2AgentProviderName } from "@codev/contracts";

import { GEN2_PROMPT_COMMANDS } from "@/lib/gen2/prompt-command";
import type { Gen2PromptCommandId } from "@/lib/gen2/prompt-command";
import { ProviderLogo } from "./provider-logos";
import type { ChatAttachment } from "./use-chat-attachments";
import type { ComposerMention } from "./use-composer-mentions";
import { WorkspaceButton } from "./workspace-button";

const MENTION_ICONS = {
  file: FileText,
  dir: Folder,
  chat: MessageSquare,
  agent: Bot,
  selection: TextCursorInput,
  terminal: SquareTerminal,
} as const;

function Chip({
  icon,
  label,
  title,
  removeLabel,
  onRemove,
  kind,
}: {
  icon: ReactNode;
  label: string;
  title?: string | undefined;
  removeLabel: string;
  onRemove: () => void;
  kind: string;
}) {
  return (
    <li className="gen2-chat-attachment" data-chip={kind} title={title}>
      {icon}
      <span>{label}</span>
      <WorkspaceButton size="icon" aria-label={removeLabel} onClick={onRemove}>
        <X aria-hidden="true" />
      </WorkspaceButton>
    </li>
  );
}

/**
 * Everything attached to the next message, above the textarea: its mode,
 * a one-message agent switch, mentions, files, and a queued follow-up.
 */
export function ChatComposerChips({
  command,
  onRemoveCommand,
  override,
  onRemoveOverride,
  mentions,
  onRemoveMention,
  attachments,
  onRemoveAttachment,
  queued,
  onCancelQueued,
}: {
  command: Gen2PromptCommandId | null;
  onRemoveCommand: () => void;
  override: { provider: Gen2AgentProviderName; label: string } | null;
  onRemoveOverride: () => void;
  mentions: ComposerMention[];
  onRemoveMention: (mention: ComposerMention) => void;
  attachments: ChatAttachment[];
  onRemoveAttachment: (id: string) => void;
  queued: boolean;
  onCancelQueued: () => void;
}) {
  const mode = GEN2_PROMPT_COMMANDS.find((entry) => entry.id === command);
  const empty =
    !mode && !override && !mentions.length && !attachments.length && !queued;
  if (empty) return null;
  return (
    <ul
      className="gen2-chat-attachments gen2-composer-chips"
      aria-label="Message context"
    >
      {mode ? (
        <Chip
          kind="mode"
          icon={null}
          label={mode.label}
          title={mode.description}
          removeLabel={`Remove ${mode.label} mode`}
          onRemove={onRemoveCommand}
        />
      ) : null}
      {override ? (
        <Chip
          kind="agent"
          icon={<ProviderLogo provider={override.provider} size={12} />}
          label={`→ ${override.label}`}
          title="Only for this message"
          removeLabel="Remove agent switch"
          onRemove={onRemoveOverride}
        />
      ) : null}
      {mentions.map((mention) => {
        const Icon = MENTION_ICONS[mention.kind];
        return (
          <Chip
            key={`${mention.kind}:${mention.ref}`}
            kind="mention"
            icon={<Icon aria-hidden="true" />}
            label={mention.label}
            title={mention.ref}
            removeLabel={`Remove mention ${mention.label}`}
            onRemove={() => onRemoveMention(mention)}
          />
        );
      })}
      {attachments.map(({ id, file }) => (
        <Chip
          key={id}
          kind="file"
          icon={<FileText aria-hidden="true" />}
          label={file.name}
          removeLabel={`Remove ${file.name}`}
          onRemove={() => onRemoveAttachment(id)}
        />
      ))}
      {queued ? (
        <li className="gen2-chat-attachment" data-chip="queued">
          <span>Queued</span>
          <WorkspaceButton
            size="toolbar"
            className="gen2-composer-chip-action"
            aria-label="Cancel queued message"
            onClick={onCancelQueued}
          >
            Cancel
          </WorkspaceButton>
        </li>
      ) : null}
    </ul>
  );
}
