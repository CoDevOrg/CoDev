"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";

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
    <div className="relative" ref={ref}>
      <h1 className="m-0">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={!hasOthers}
          onClick={() => setOpen((value) => !value)}
          style={{ color: "var(--color-foreground)" }}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[17px] font-semibold tracking-tight disabled:cursor-default enabled:hover:bg-muted"
        >
          <span className="truncate">{title}</span>
          {hasOthers ? (
            <ChevronDown
              aria-hidden="true"
              className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            />
          ) : null}
        </button>
      </h1>
      <AnimatePresence>
        {open && hasOthers ? (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute top-full left-0 z-20 mt-1.5 w-64 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl shadow-foreground/10"
          >
            <div className="px-2.5 py-1.5 text-[10.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
              Switch room
            </div>
            {others.map((room) => (
              <Link
                key={room.id}
                href={`/rooms/${room.id}`}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-[13px] hover:bg-muted"
              >
                <span className="truncate">{room.title}</span>
                {typeof room.messageCount === "number" ? (
                  <small className="text-muted-foreground">
                    {room.messageCount}
                  </small>
                ) : null}
              </Link>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
