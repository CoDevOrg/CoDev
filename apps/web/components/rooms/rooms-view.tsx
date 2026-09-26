"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, MessageSquareText, Plus } from "lucide-react";

import type { SharedChatSummary } from "@/lib/chat/shared-chat";

import { RoomImportPanel } from "./room-import-panel";
import styles from "@/app/rooms/rooms.module.css";

export function RoomsView({ rooms }: { rooms: SharedChatSummary[] }) {
  const [importOpen, setImportOpen] = useState(false);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span>Collaborative conversations</span>
          <h1>Rooms</h1>
          <p>Your imported chats and lightweight collaboration rooms.</p>
        </div>
        <button
          type="button"
          className={styles.createLink}
          aria-expanded={importOpen}
          onClick={() => setImportOpen((value) => !value)}
        >
          <Plus aria-hidden="true" />
          Import a chat
        </button>
      </header>

      <RoomImportPanel open={importOpen} />

      {rooms.length ? (
        <div className={styles.grid}>
          {rooms.map((room) => (
            <Link
              href={`/rooms/${room.id}`}
              className={styles.roomCard}
              key={room.id}
            >
              <MessageSquareText aria-hidden="true" />
              <div>
                <h2>{room.title}</h2>
                <p>
                  {room.messageCount}{" "}
                  {room.messageCount === 1 ? "message" : "messages"}
                  {room.sourceProvider
                    ? ` · Imported from ${room.sourceProvider}`
                    : ""}
                </p>
              </div>
              <ArrowRight aria-hidden="true" />
            </Link>
          ))}
        </div>
      ) : !importOpen ? (
        <section className={styles.empty}>
          <MessageSquareText aria-hidden="true" />
          <h2>No rooms yet</h2>
          <p>Import a shared AI chat to create your first room.</p>
          <button type="button" onClick={() => setImportOpen(true)}>
            Import a chat
          </button>
        </section>
      ) : null}
    </main>
  );
}
