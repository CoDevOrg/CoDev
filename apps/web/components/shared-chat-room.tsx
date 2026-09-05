import { ExternalLink, LockKeyhole, Users } from "lucide-react";

import type { SharedChatRoom as SharedChatRoomData } from "@/lib/shared-chat";

import { SharedChatInvite } from "./shared-chat-invite";
import { SharedChatTranscript } from "./shared-chat-transcript";
import styles from "./shared-chat-room.module.css";

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
              <Users aria-hidden="true" /> {room.members.length}{" "}
              {room.members.length === 1 ? "member" : "members"}
            </span>
            {conversation.source.model ? (
              <span>Model: {conversation.source.model}</span>
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

      <SharedChatTranscript
        roomId={room.id}
        initialMessages={conversation.messages}
      />
    </main>
  );
}
