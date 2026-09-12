/**
 * Re-wrap stored secrets from one cloud's key service to the other's.
 *
 * This is an optimisation, not a cutover gate. `apps/web/lib/kms.ts` decrypts
 * on the envelope's own version prefix rather than on `CLOUD_PROVIDER`, so
 * AWS-wrapped secrets keep working after the switch to Azure and
 * Azure-wrapped ones keep working after a rollback. What this buys is the
 * ability to eventually retire the old key: until every row is re-wrapped,
 * deleting the KMS key would destroy whatever is still sealed under it.
 *
 * Run with both clouds reachable, because a single pass decrypts with the old
 * provider and encrypts with the new one:
 *
 *   CLOUD_PROVIDER=azure \
 *   CREDENTIAL_KMS_KEY_ID=...        # reads the existing AWS envelopes
 *   CREDENTIAL_KEY_VAULT_KEY_ID=...  # writes the new Azure ones
 *   pnpm rewrap:credentials --commit
 *
 * Defaults to a dry run; pass --commit to write.
 *
 * The pnpm script passes `--conditions react-server`, which is load-bearing:
 * this reaches into apps/web/lib/kms.ts, and every module in that tree opens
 * with `import "server-only"`, whose default export throws by design. The
 * react-server condition resolves that marker to its empty build instead,
 * which is exactly the condition Next.js itself runs those modules under.
 */
import { eq, isNotNull, or } from "drizzle-orm";

import { createDatabase, schema } from "@codev/db";

import {
  decryptSecret,
  encryptSecret,
  envelopeProvider,
} from "../apps/web/lib/kms";

const commit = process.argv.includes("--commit");

/**
 * Every encrypted column, with the exact encryption context its writer uses.
 *
 * The context has to be reproduced byte for byte. It is authenticated data,
 * so getting it wrong fails the decrypt outright rather than silently
 * producing garbage -- which is the behaviour you want from a mistake in a
 * migration script. Each entry below was taken from the call site that
 * writes the column, not inferred.
 */
type ColumnPlan = {
  table: string;
  column: string;
  /** Context for a given row, or undefined when the writer passes none. */
  context: (row: Record<string, unknown>) => Record<string, string> | undefined;
};

const PROVIDER_CONTEXT = {
  application: "codev",
  purpose: "provider-credential",
};

const HOSTED_CODEX_CONTEXT = {
  application: "codev",
  purpose: "hosted-codex-subscription",
};

const PLANS: Array<{
  name: string;
  table: typeof schema.providerCredentials;
  columns: ColumnPlan[];
}> = [
  {
    name: "provider_credentials",
    table: schema.providerCredentials,
    columns: [
      // credentials.ts writes these three with providerContext().
      {
        table: "provider_credentials",
        column: "encryptedApiKey",
        context: () => PROVIDER_CONTEXT,
      },
      {
        table: "provider_credentials",
        column: "encryptedAccessToken",
        context: () => PROVIDER_CONTEXT,
      },
      {
        table: "provider_credentials",
        column: "encryptedRefreshToken",
        context: () => PROVIDER_CONTEXT,
      },
      // hosted-codex-subscription-credentials.ts writes this one with its own.
      {
        table: "provider_credentials",
        column: "encryptedMaterial",
        context: () => HOSTED_CODEX_CONTEXT,
      },
    ],
  },
  {
    name: "user_environment_variables",
    table: schema.userEnvironmentVariables as never,
    columns: [
      {
        table: "user_environment_variables",
        column: "encryptedValue",
        context: (row) => ({
          purpose: "user-environment-variable",
          userId: String(row.userId),
        }),
      },
    ],
  },
  {
    name: "github_connections",
    table: schema.githubConnections as never,
    columns: [
      // github.ts calls encryptSecret with no context at all, so these must
      // be re-wrapped without one. Passing PROVIDER_CONTEXT here would fail
      // every decrypt.
      {
        table: "github_connections",
        column: "encryptedAccessToken",
        context: () => undefined,
      },
      {
        table: "github_connections",
        column: "encryptedRefreshToken",
        context: () => undefined,
      },
    ],
  },
];

/**
 * Shared-chat invite tokens are deliberately excluded.
 *
 * They are wrapped with a per-room context and expire within the invite TTL,
 * so re-wrapping them costs a decrypt per row to preserve values that are
 * worthless within hours. Letting them age out is both cheaper and safer;
 * the rows drain on their own well before the old key can be retired.
 */

async function main() {
  const target = process.env.CLOUD_PROVIDER === "azure" ? "azure" : "aws";

  // Not apps/web/lib/database.ts: that one attaches a Vercel function pool
  // and assumes a request context neither of which exists in a CLI run.
  const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Set POSTGRES_URL or DATABASE_URL.");
  }
  const client = createDatabase(connectionString);
  const database = client.db;

  let scanned = 0;
  let rewrapped = 0;
  let alreadyCurrent = 0;
  const failures: Array<{ where: string; reason: string }> = [];

  for (const plan of PLANS) {
    const conditions = plan.columns.map((entry) =>
      isNotNull((plan.table as unknown as Record<string, never>)[entry.column]),
    );
    const rows = (await database
      .select()
      .from(plan.table as never)
      .where(
        conditions.length === 1 ? conditions[0] : or(...conditions),
      )) as Array<Record<string, unknown>>;

    for (const row of rows) {
      const updates: Record<string, string> = {};

      for (const entry of plan.columns) {
        const stored = row[entry.column];
        if (typeof stored !== "string" || stored === "") continue;

        scanned += 1;
        if (envelopeProvider(stored) === target) {
          alreadyCurrent += 1;
          continue;
        }

        const context = entry.context(row);
        try {
          const plaintext = await decryptSecret(stored, context);
          updates[entry.column] = await encryptSecret(plaintext, context);
          rewrapped += 1;
        } catch (error) {
          // Never abort the run on one bad row. A secret that cannot be
          // decrypted is already broken, and stopping here would leave the
          // table half-migrated with no record of which half.
          failures.push({
            where: `${plan.name}/${String(row.id)}.${entry.column}`,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (commit && Object.keys(updates).length > 0) {
        await database
          .update(plan.table as never)
          .set(updates as never)
          .where(
            eq(
              (plan.table as unknown as Record<string, never>).id,
              row.id as never,
            ),
          );
      }
    }
  }

  console.log(`target provider    ${target}`);
  console.log(`values scanned     ${scanned}`);
  console.log(`already on target  ${alreadyCurrent}`);
  console.log(
    `${commit ? "re-wrapped        " : "would re-wrap     "} ${rewrapped}`,
  );
  console.log(`failures           ${failures.length}`);

  for (const failure of failures) {
    console.error(`  ${failure.where}: ${failure.reason}`);
  }
  if (!commit) console.log("\nDry run. Pass --commit to write.");

  await client.pool.end();

  // Non-zero on failures keeps this honest: a partially successful re-wrap
  // must not look like a green step.
  process.exit(failures.length > 0 ? 1 : 0);
}

void main();
