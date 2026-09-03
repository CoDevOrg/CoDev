import { ExternalLink, LockKeyhole, Paperclip, Users } from "lucide-react";

import type { ImportedConversationMessage } from "@codev/contracts";

import type { SharedChatRoom as SharedChatRoomData } from "@/lib/shared-chat";

import { SharedChatComposer } from "./shared-chat-composer";
import { SharedChatInvite } from "./shared-chat-invite";
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
            <span>
              <Users aria-hidden="true" /> {room.members.length}{" "}
              {room.members.length === 1 ? "member" : "members"}
            </span>
            {conversation.source.model ? (
              <span>{conversation.source.model}</span>
            ) : null}
          </div>
        </div>
        <div className={styles.headerActions}>
          {room.viewerRole === "owner" ? (
            <SharedChatInvite roomId={room.id} />
          ) : null}
          <a
            href={conversation.source.url}
            target="_blank"
            rel="noreferrer"
            className={styles.sourceLink}
          >
            Open original
            <ExternalLink aria-hidden="true" />
          </a>
        </div>
      </header>

      <div className={styles.roomNote}>
        {room.viewerRole === "owner"
          ? "Create an invite link to bring another authenticated member into this room."
          : "You joined this room through an invitation and can contribute to its conversation."}
      </div>

      <section className={styles.memberPanel} aria-label="Room members">
        <div className={styles.memberHeading}>
          <Users aria-hidden="true" />
          <strong>People in this room</strong>
        </div>
        <ul>
          {room.members.map((member) => (
            <li key={member.userId}>
              {member.avatarUrl ? (
                <img src={member.avatarUrl} alt="" />
              ) : (
                <span aria-hidden="true">
                  {(member.name ?? member.login).slice(0, 1).toUpperCase()}
                </span>
              )}
              <div>
                <strong>{member.name ?? member.login}</strong>
                <small>@{member.login}</small>
              </div>
              <em>{member.role}</em>
            </li>
          ))}
        </ul>
      </section>

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
        <SharedChatComposer roomId={room.id} />
      </section>
    </main>
  );
}
