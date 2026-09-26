import type { Metadata } from "next";

import "./rooms-theme.css";

import { AppChrome } from "@/components/shell/app-chrome";
import { RoomsView } from "@/components/rooms/rooms-view";
import { requireUser } from "@/lib/auth/session";
import { listSharedChatsForUser } from "@/lib/chat/shared-chat";

export const metadata: Metadata = { title: "Rooms" };

export default async function RoomsPage() {
  const user = await requireUser();
  const rooms = await listSharedChatsForUser(user.id);

  return (
    <AppChrome user={user} sidebar>
      <RoomsView rooms={rooms} />
    </AppChrome>
  );
}
