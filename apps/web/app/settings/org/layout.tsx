import { getActiveOrganizationSettingsContext } from "@/lib/organization-settings";
import { requireUser } from "@/lib/session";

/**
 * Every Organization settings route performs a workspace membership and FGA
 * read check before its page renders. Individual mutations use the write
 * guard in lib/settings-access.ts as well.
 */
export default async function OrganizationSettingsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireUser();
  await getActiveOrganizationSettingsContext(user.id);
  return children;
}
