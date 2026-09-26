import { ExternalLink, LockKeyhole, Users } from "lucide-react";

import type { SharedChatRoom as SharedChatRoomData } from "@/lib/chat/shared-chat";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

import { avatarColor, avatarInitials } from "./shared-chat-avatar";
import { SharedChatInvite } from "./shared-chat-invite";
import {
  SharedChatRoomSwitcher,
  type RoomSwitcherOption,
} from "./shared-chat-room-switcher";
import { SharedChatTranscript } from "./shared-chat-transcript";

const AVATAR_STACK_LIMIT = 4;

export function SharedChatRoom({
  room,
  rooms = [],
}: {
  room: SharedChatRoomData;
  rooms?: RoomSwitcherOption[];
}) {
  const { conversation } = room;
  const stacked = room.members.slice(0, AVATAR_STACK_LIMIT);
  const overflow = room.members.length - stacked.length;

  return (
    <main className="rooms-scope grid min-h-dvh grid-cols-1 grid-rows-[auto_1fr] lg:grid-cols-[minmax(0,1fr)_300px]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4 lg:col-span-2">
        <SharedChatRoomSwitcher
          currentId={room.id}
          title={conversation.title}
          rooms={rooms}
        />
        <div className="flex items-center gap-4 text-[12.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <LockKeyhole aria-hidden="true" className="size-3.5" />
            Private
          </span>
          <span>
            {room.members.length}{" "}
            {room.members.length === 1 ? "member" : "members"}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-col">
        {conversation.warnings.length ? (
          <div className="mx-6 mt-4 rounded-lg border border-violet/30 bg-violet/8 px-3.5 py-2.5 text-xs text-violet">
            {conversation.warnings.map((warning) => (
              <p
                key={warning}
                className="m-0 first:mt-0 [&:not(:first-child)]:mt-1"
              >
                {warning}
              </p>
            ))}
          </div>
        ) : null}
        <SharedChatTranscript
          roomId={room.id}
          initialMessages={conversation.messages}
        />
      </div>

      <aside
        aria-label="Room details"
        className="flex flex-col gap-4 border-t border-border p-5 lg:border-t-0 lg:border-l"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex -space-x-2" aria-hidden="true">
            {stacked.map((member) => (
              <Avatar key={member.userId} className="size-7">
                {member.avatarUrl ? (
                  <AvatarImage src={member.avatarUrl} alt="" />
                ) : null}
                <AvatarFallback
                  style={{
                    background: avatarColor(member.login ?? member.userId),
                    color: "#f7f3e8",
                  }}
                >
                  {avatarInitials(member.name ?? member.login)}
                </AvatarFallback>
              </Avatar>
            ))}
            {overflow > 0 ? (
              <Avatar className="size-7">
                <AvatarFallback>+{overflow}</AvatarFallback>
              </Avatar>
            ) : null}
          </div>
          {room.viewerRole === "owner" ? (
            <SharedChatInvite roomId={room.id} />
          ) : null}
        </div>

        <Card className="flex flex-col gap-2.5 p-4">
          <h2 className="m-0 text-[13px] font-semibold tracking-tight">
            Details
          </h2>
          {conversation.source.model ? (
            <p className="m-0 flex items-center justify-between text-[12.5px]">
              <span className="text-muted-foreground">Model</span>
              <strong className="font-semibold">
                {conversation.source.model}
              </strong>
            </p>
          ) : null}
          <a
            href={conversation.source.url}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--color-primary)" }}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium hover:underline"
          >
            <ExternalLink aria-hidden="true" className="size-3.5" />
            Open original
          </a>
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <h2 className="m-0 flex items-center gap-1.5 text-[13px] font-semibold tracking-tight">
            <Users aria-hidden="true" className="size-3.5" />
            In this room
          </h2>
          <ul className="flex flex-col gap-3">
            {room.members.map((member) => (
              <li key={member.userId} className="flex items-center gap-2.5">
                <Avatar className="size-8">
                  {member.avatarUrl ? (
                    <AvatarImage src={member.avatarUrl} alt="" />
                  ) : null}
                  <AvatarFallback
                    style={{
                      background: avatarColor(member.login ?? member.userId),
                      color: "#f7f3e8",
                    }}
                  >
                    {avatarInitials(member.name ?? member.login)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-[12.5px] font-semibold">
                    {member.name ?? member.login}
                  </strong>
                  <small className="block truncate text-[11px] text-muted-foreground">
                    @{member.login}
                  </small>
                </div>
                <Badge variant="muted" className="capitalize">
                  {member.role}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>

        <p className="m-0 text-[11.5px] leading-relaxed text-muted-foreground">
          {room.viewerRole === "owner"
            ? "Create an invite link to bring another authenticated member into this room."
            : "You joined this room through an invitation and can contribute to its conversation."}
        </p>
      </aside>
    </main>
  );
}
