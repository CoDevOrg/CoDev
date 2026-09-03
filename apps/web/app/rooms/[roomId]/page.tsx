import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppChrome } from "@/components/app-chrome";
import { SharedChatRoom } from "@/components/shared-chat-room";
import { requireUser } from "@/lib/session";
import { getSharedChatRoom } from "@/lib/shared-chat";

export const metadata: Metadata = { title: "Collaborative room" };

export default async function SharedChatRoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const user = await requireUser();
  const { roomId } = await params;
  const room = await getSharedChatRoom(roomId, user.id);
  if (!room) notFound();

  return (
    <AppChrome user={user} sidebar>
      <SharedChatRoom room={room} />
    </AppChrome>
  );
}
