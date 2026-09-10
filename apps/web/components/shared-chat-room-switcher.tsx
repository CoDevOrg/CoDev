"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

import styles from "./shared-chat-room.module.css";

export type RoomSwitcherOption = {
  id: string;
  title: string;
  messageCount?: number;
};

export function SharedChatRoomSwitcher({
  currentId,
  title,
  rooms,
}: {
  currentId: string;
  title: string;
  rooms: RoomSwitcherOption[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const others = rooms.filter((room) => room.id !== currentId);
  const hasOthers = others.length > 0;

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.switcher} ref={ref}>
      <h1 className={styles.switcherTitle}>
        <button
          type="button"
          className={styles.switcherBtn}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={!hasOthers}
          onClick={() => setOpen((value) => !value)}
        >
          <span className={styles.switcherName}>{title}</span>
          {hasOthers ? (
            <ChevronDown className={styles.switcherChev} aria-hidden="true" />
          ) : null}
        </button>
      </h1>
      {open && hasOthers ? (
        <div className={styles.switcherMenu} role="menu">
          <div className={styles.menuLabel}>Switch room</div>
          {others.map((room) => (
            <Link
              key={room.id}
              href={`/rooms/${room.id}`}
              className={styles.switcherItem}
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              <span>{room.title}</span>
              {typeof room.messageCount === "number" ? (
                <small>{room.messageCount}</small>
              ) : null}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
