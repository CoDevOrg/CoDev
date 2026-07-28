import type { Metadata } from "next";

import { AppChrome } from "@/components/app-chrome";
import { CredentialForm } from "@/components/credential-form";
import { getOpenAICredentialStatus } from "@/lib/credentials";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const credential = await getOpenAICredentialStatus(user.id);

  return (
    <AppChrome user={user}>
      <main className="settings-shell">
        <header className="page-title">
          <p className="eyebrow">Personal settings</p>
          <h1>Agent credentials</h1>
          <p>
            Your provider key is encrypted before storage and is never returned
            to the browser after saving.
          </p>
        </header>
        <section className="panel settings-panel">
          <div className="settings-provider">
            <span className="provider-mark" aria-hidden="true">
              ◎
            </span>
            <div>
              <h2>OpenAI</h2>
              <p>Used only for agent turns you author.</p>
            </div>
          </div>
          <CredentialForm currentLastFour={credential?.lastFour} />
          <div className="security-callout">
            <strong>Security boundary</strong>
            <p>
              CoDev keeps credentials in PostgreSQL using authenticated
              encryption. Sandboxes receive neither your provider key nor your
              GitHub user token.
            </p>
          </div>
        </section>
      </main>
    </AppChrome>
  );
}
