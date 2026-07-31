import type { AppUser } from "@/lib/identity";
import type { OrganizationSettingsContext } from "@/lib/settings-access";

export function SettingsPageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="settings-page-header">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}

export function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel settings-panel settings-card">
      <div className="settings-card-heading">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export function SettingsPlaceholder({
  title,
  description,
  detail,
}: {
  title: string;
  description: string;
  detail: string;
}) {
  return (
    <SettingsCard description={description} title={title}>
      <div className="settings-placeholder">
        <span aria-hidden="true" className="settings-placeholder-mark">
          •
        </span>
        <strong>Ready for setup</strong>
        <p>{detail}</p>
      </div>
    </SettingsCard>
  );
}

export function ProfileSettings({ user }: { user: AppUser }) {
  return (
    <>
      <SettingsCard
        description="The identity and contact details connected to your CoDev account."
        title="Profile"
      >
        <div className="settings-profile-grid">
          <div>
            <span className="settings-field-label">Display name</span>
            <strong>{user.name ?? "Not set"}</strong>
          </div>
          <div>
            <span className="settings-field-label">Email</span>
            <strong>{user.email ?? "Not set"}</strong>
          </div>
          <div>
            <span className="settings-field-label">GitHub handle</span>
            <strong>
              {user.githubLogin ? `@${user.githubLogin}` : "Not connected"}
            </strong>
          </div>
          <div>
            <span className="settings-field-label">Security</span>
            <strong>Managed by your sign-in provider</strong>
          </div>
        </div>
      </SettingsCard>
      <SettingsCard
        description="Authentication and SSO controls are kept with your configured identity provider."
        title="Security & SSO"
      >
        <p className="settings-muted-copy">
          Sign-in, session security, and single sign-on policies will appear
          here as your organization connects an identity provider.
        </p>
      </SettingsCard>
    </>
  );
}

export function OrganizationSettingsPage({
  context,
  title,
  description,
  children,
}: {
  context: OrganizationSettingsContext | null;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  if (!context) {
    return (
      <div className="settings-page">
        <SettingsPageHeader
          description={description}
          eyebrow="Organization settings"
          title={title}
        />
        <SettingsCard
          description="Join or create a workspace before configuring shared settings."
          title="No organization selected"
        >
          <p className="settings-muted-copy">
            Organization settings become available when you have access to a
            workspace.
          </p>
        </SettingsCard>
      </div>
    );
  }

  const roleLabel = context.role === "co_steer" ? "Admin" : context.role;

  return (
    <div className="settings-page">
      <SettingsPageHeader
        description={description}
        eyebrow={`Organization settings · ${context.workspace.repository}`}
        title={title}
      />
      <div className="settings-scope-meta">
        <span className="settings-scope-badge">{roleLabel}</span>
        <span>
          {context.canWrite
            ? "You can manage shared organization settings."
            : "Read-only access for this workspace."}
        </span>
      </div>
      {!context.canWrite ? (
        <div className="settings-readonly-banner" role="status">
          <strong>Read-only view</strong>
          <span>
            Only workspace Owners and Admins can change organization settings.
          </span>
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function OrganizationSettingsCard({
  context,
  title,
  description,
  detail,
}: {
  context: OrganizationSettingsContext | null;
  title: string;
  description: string;
  detail: string;
}) {
  return (
    <SettingsCard description={description} title={title}>
      <div className="settings-org-resource">
        <div>
          <strong>
            {context?.canWrite ? "Managed resource" : "Resource summary"}
          </strong>
          <p>{detail}</p>
        </div>
        <span className="settings-resource-status">
          {context?.canWrite ? "Admin access" : "Read only"}
        </span>
      </div>
    </SettingsCard>
  );
}
