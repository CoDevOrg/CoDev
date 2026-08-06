import "server-only";

import {
  createEnvironmentVariableSchema,
  updateEnvironmentVariableSchema,
  type EnvironmentVariable,
} from "@codev/contracts";
import { schema } from "@codev/db";
import { and, asc, eq, sql } from "drizzle-orm";

import { decryptSecret, encryptSecret } from "./kms";
import { getDatabase } from "./database";

const MAX_VARIABLES_PER_USER = 100;

function envContext(userId: string) {
  return { purpose: "user-environment-variable", userId };
}

function lastFourOf(value: string) {
  const trimmed = value.trim();
  return trimmed.slice(-Math.min(4, trimmed.length));
}

function toPublicVariable(row: {
  id: string;
  name: string;
  lastFour: string | null;
  createdAt: Date;
  updatedAt: Date;
}): EnvironmentVariable {
  return {
    id: row.id,
    name: row.name,
    lastFour: row.lastFour,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listUserEnvironmentVariables(
  userId: string,
): Promise<EnvironmentVariable[]> {
  const rows = await getDatabase()
    .select({
      id: schema.userEnvironmentVariables.id,
      name: schema.userEnvironmentVariables.name,
      lastFour: schema.userEnvironmentVariables.lastFour,
      createdAt: schema.userEnvironmentVariables.createdAt,
      updatedAt: schema.userEnvironmentVariables.updatedAt,
    })
    .from(schema.userEnvironmentVariables)
    .where(eq(schema.userEnvironmentVariables.userId, userId))
    .orderBy(asc(schema.userEnvironmentVariables.name));

  return rows.map(toPublicVariable);
}

export async function listDecryptedUserEnvironmentVariables(userId: string) {
  const rows = await getDatabase()
    .select({
      name: schema.userEnvironmentVariables.name,
      encryptedValue: schema.userEnvironmentVariables.encryptedValue,
    })
    .from(schema.userEnvironmentVariables)
    .where(eq(schema.userEnvironmentVariables.userId, userId))
    .orderBy(asc(schema.userEnvironmentVariables.name));

  const variables: Record<string, string> = {};
  for (const row of rows) {
    variables[row.name] = await decryptSecret(
      row.encryptedValue,
      envContext(userId),
    );
  }
  return variables;
}

export async function createUserEnvironmentVariable(
  userId: string,
  input: unknown,
) {
  const parsed = createEnvironmentVariableSchema.parse(input);
  const database = getDatabase();

  const countRows = await database
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(schema.userEnvironmentVariables)
    .where(eq(schema.userEnvironmentVariables.userId, userId));
  const count = countRows[0]?.count ?? 0;

  if (count >= MAX_VARIABLES_PER_USER) {
    throw new Error(
      `You can store up to ${MAX_VARIABLES_PER_USER} environment variables.`,
    );
  }

  const encryptedValue = await encryptSecret(
    parsed.value,
    envContext(userId),
  );

  try {
    const [row] = await database
      .insert(schema.userEnvironmentVariables)
      .values({
        userId,
        name: parsed.name,
        encryptedValue,
        lastFour: lastFourOf(parsed.value),
        keyVersion: 2,
      })
      .returning({
        id: schema.userEnvironmentVariables.id,
        name: schema.userEnvironmentVariables.name,
        lastFour: schema.userEnvironmentVariables.lastFour,
        createdAt: schema.userEnvironmentVariables.createdAt,
        updatedAt: schema.userEnvironmentVariables.updatedAt,
      });
    if (!row) throw new Error("Environment variable could not be saved.");
    return toPublicVariable(row);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "23505"
    ) {
      throw new Error(`Variable ${parsed.name} already exists.`);
    }
    throw error;
  }
}

export async function updateUserEnvironmentVariable(
  userId: string,
  variableId: string,
  input: unknown,
) {
  const parsed = updateEnvironmentVariableSchema.parse(input);
  const encryptedValue = await encryptSecret(
    parsed.value,
    envContext(userId),
  );

  const [row] = await getDatabase()
    .update(schema.userEnvironmentVariables)
    .set({
      encryptedValue,
      lastFour: lastFourOf(parsed.value),
      keyVersion: 2,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.userEnvironmentVariables.id, variableId),
        eq(schema.userEnvironmentVariables.userId, userId),
      ),
    )
    .returning({
      id: schema.userEnvironmentVariables.id,
      name: schema.userEnvironmentVariables.name,
      lastFour: schema.userEnvironmentVariables.lastFour,
      createdAt: schema.userEnvironmentVariables.createdAt,
      updatedAt: schema.userEnvironmentVariables.updatedAt,
    });

  if (!row) throw new Error("Environment variable not found.");
  return toPublicVariable(row);
}

export async function deleteUserEnvironmentVariable(
  userId: string,
  variableId: string,
) {
  const deleted = await getDatabase()
    .delete(schema.userEnvironmentVariables)
    .where(
      and(
        eq(schema.userEnvironmentVariables.id, variableId),
        eq(schema.userEnvironmentVariables.userId, userId),
      ),
    )
    .returning({ id: schema.userEnvironmentVariables.id });

  if (deleted.length === 0) {
    throw new Error("Environment variable not found.");
  }
}

export { MAX_VARIABLES_PER_USER };
