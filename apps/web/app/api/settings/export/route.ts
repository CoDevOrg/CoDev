import { eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { getConnectedAccounts } from "@/lib/auth/identity";
import { apiError, getApiUser } from "@/lib/http/api";
import { getDatabase } from "@/lib/platform/database";
import { listUserEnvironmentVariables } from "@/lib/providers/user-environment";

/**
 * A copy of the account facts a member can see in Settings. Secrets are never
 * included: environment variables are listed by name only, and provider
 * credentials are not exported at all.
 */
export async function GET() {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  try {
    const [row] = await getDatabase()
      .select({
        name: schema.users.name,
        email: schema.users.email,
        login: schema.users.login,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, user.id))
      .limit(1);
    const accounts = await getConnectedAccounts(user.id);
    const variables = await listUserEnvironmentVariables(user.id);

    const body = {
      exportedAt: new Date().toISOString(),
      profile: {
        id: user.id,
        name: row?.name ?? null,
        email: row?.email ?? null,
        login: row?.login ?? null,
        createdAt: row?.createdAt?.toISOString() ?? null,
      },
      signInMethods: {
        google: accounts.google.connected,
        github: accounts.github.connected
          ? { login: accounts.github.login ?? null }
          : false,
        password: accounts.hasPassword,
      },
      environmentVariables: variables.map((variable) => ({
        name: variable.name,
        createdAt: variable.createdAt,
        updatedAt: variable.updatedAt,
      })),
    };

    return new Response(JSON.stringify(body, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="codev-account.json"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
