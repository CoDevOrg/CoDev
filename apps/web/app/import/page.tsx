import type { Metadata } from "next";

import { AppChrome } from "@/components/shell/app-chrome";
import { ConversationImportPreview } from "@/components/chat/conversation-import-preview";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Import chat" };

export default async function ImportChatPage() {
  const user = await requireUser();

  return (
    <AppChrome user={user} sidebar>
      <main>
        <ConversationImportPreview />
      </main>
    </AppChrome>
  );
}
