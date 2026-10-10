"use client";

import type { CSSProperties } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/platform/utils";
import { memberColor } from "./member-color";

function initials(label: string) {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? `${parts[0]![0]}${parts.at(-1)![0]}` : label.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * A member's avatar in their presence colour. Used by the presence stack,
 * chat authorship and the file tree, so a person looks the same everywhere.
 */
export function MemberAvatar({
  id,
  name,
  avatarUrl,
  away = false,
  className,
}: {
  id: string;
  name: string;
  avatarUrl?: string | null | undefined;
  away?: boolean;
  className?: string;
}) {
  const color = memberColor(id);
  return (
    <Avatar
      className={cn("gen2-member-avatar", className)}
      data-away={away ? "true" : undefined}
      style={
        {
          "--member-color": color.color,
          "--member-ink": color.ink,
        } as CSSProperties
      }
    >
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
