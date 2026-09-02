import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MessageSquareText, Plus } from "lucide-react";

import { AppChrome } from "@/components/app-chrome";
import { requireUser } from "@/lib/session";
import { listSharedChatsForUser } from "@/lib/shared-chat";

import styles from "./rooms.module.css";

export const metadata: Metadata = { title: "Rooms" };

export default async function RoomsPage() {
  const user = await requireUser();
  const rooms = await listSharedChatsForUser(user.id);

  return (
    <AppChrome user={user} sidebar>
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <span>Collaborative conversations</span>
            <h1>Rooms</h1>
            <p>Your imported chats and lightweight collaboration rooms.</p>
          </div>
          <Link href="/import" className={styles.createLink}>
            <Plus aria-hidden="true" />
            Import a chat
          </Link>
        </header>

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
        ) : (
          <section className={styles.empty}>
            <MessageSquareText aria-hidden="true" />
            <h2>No rooms yet</h2>
            <p>Import a shared AI chat to create your first room.</p>
            <Link href="/import">Import a chat</Link>
          </section>
        )}
      </main>
    </AppChrome>
  );
}
