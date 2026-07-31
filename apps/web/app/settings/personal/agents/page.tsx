import { CredentialForm } from "@/components/credential-form";
import {
  SettingsCard,
  SettingsPageHeader,
} from "@/components/settings/settings-content";
import { getOpenAICredentialStatus } from "@/lib/credentials";
import { requireUser } from "@/lib/session";

export default async function PersonalAgentsPage() {
  const user = await requireUser();
  const credential = await getOpenAICredentialStatus(user.id);

  return (
    <div className="settings-page">
      <SettingsPageHeader
        description="Connect private provider keys used for the agent turns you author."
        eyebrow="Personal settings"
        title="Coding agents"
      />
      <SettingsCard
        description="Your personal key takes priority over organization fallback credentials."
        title="OpenAI"
      >
        <CredentialForm currentLastFour={credential?.lastFour ?? undefined} />
        <div className="security-callout">
          <strong>Security boundary</strong>
          <p>
            CoDev encrypts credentials before storage and never returns the full
            key to the browser or sends it to a sandbox.
          </p>
        </div>
      </SettingsCard>
    </div>
  );
}
