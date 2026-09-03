import type { Metadata } from "next";

import { AppChrome } from "@/components/app-chrome";
import { ConversationImportPreview } from "@/components/conversation-import-preview";
import { requireUser } from "@/lib/session";

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
