import { ExternalLink, LockKeyhole, Paperclip } from "lucide-react";

import type { ImportedConversationMessage } from "@codev/contracts";

import type { SharedChatRoom as SharedChatRoomData } from "@/lib/shared-chat";

import styles from "./shared-chat-room.module.css";

function messageLabel(message: ImportedConversationMessage) {
  if (message.authorName) return message.authorName;
  if (message.role === "assistant") return "Assistant";
  return message.role.charAt(0).toUpperCase() + message.role.slice(1);
}

function messageClass(message: ImportedConversationMessage) {
  if (message.role === "user") return styles.userMessage;
  if (message.role === "assistant") return styles.assistantMessage;
  return styles.contextMessage;
}

export function SharedChatRoom({ room }: { room: SharedChatRoomData }) {
  const { conversation } = room;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Collaborative room</span>
          <h1>{conversation.title}</h1>
          <div className={styles.meta}>
            <span>
              <LockKeyhole aria-hidden="true" /> Private
            </span>
            <span>
              {conversation.messages.length}{" "}
              {conversation.messages.length === 1 ? "message" : "messages"}
            </span>
            {conversation.source.model ? (
              <span>{conversation.source.model}</span>
            ) : null}
          </div>
        </div>
        <a
          href={conversation.source.url}
          target="_blank"
          rel="noreferrer"
          className={styles.sourceLink}
        >
          Open original
          <ExternalLink aria-hidden="true" />
        </a>
      </header>

      <div className={styles.roomNote}>
        This room is saved and ready for collaboration. Only you can access it
        until member invitations are added.
      </div>

      {conversation.warnings.length ? (
        <div className={styles.warnings}>
          {conversation.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      <section className={styles.transcript} aria-label="Conversation messages">
        {conversation.messages.map((message) => (
          <article
            className={`${styles.message} ${messageClass(message)}`}
            key={message.sequence}
            aria-label={`${messageLabel(message)} message ${message.sequence + 1}`}
          >
            <strong>{messageLabel(message)}</strong>
            <p>{message.text}</p>
            {message.artifacts.length ? (
              <ul aria-label="Message attachments">
                {message.artifacts.map((artifact) => (
                  <li key={`${artifact.kind}-${artifact.sourceUrl}`}>
                    <Paperclip aria-hidden="true" />
                    <span>{artifact.filename}</span>
                    <small>{artifact.kind}</small>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </section>
    </main>
  );
}
