import "server-only";

import { and, eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { decryptSecret, encryptSecret } from "./crypto";
import { getDatabase } from "./database";

const OPENAI_PROVIDER = "openai";

export async function getOpenAICredentialStatus(userId: string) {
  const [credential] = await getDatabase()
    .select({
      lastFour: schema.providerCredentials.lastFour,
      updatedAt: schema.providerCredentials.updatedAt,
    })
    .from(schema.providerCredentials)
    .where(
      and(
        eq(schema.providerCredentials.userId, userId),
        eq(schema.providerCredentials.provider, OPENAI_PROVIDER),
      ),
    )
    .limit(1);

  return credential ?? null;
}

export async function getOpenAIApiKey(userId: string) {
  const [credential] = await getDatabase()
    .select({ encryptedValue: schema.providerCredentials.encryptedValue })
    .from(schema.providerCredentials)
    .where(
      and(
        eq(schema.providerCredentials.userId, userId),
        eq(schema.providerCredentials.provider, OPENAI_PROVIDER),
      ),
    )
    .limit(1);

  if (!credential) {
    throw new Error(
      "Add an OpenAI API key in Settings before starting an agent turn.",
    );
  }
  return decryptSecret(credential.encryptedValue);
}

export async function saveOpenAICredential(userId: string, apiKey: string) {
  const normalized = apiKey.trim();
  if (!normalized.startsWith("sk-") || normalized.length < 20) {
    throw new Error("Enter a valid OpenAI API key.");
  }

  await getDatabase()
    .insert(schema.providerCredentials)
    .values({
      userId,
      provider: OPENAI_PROVIDER,
      encryptedValue: encryptSecret(normalized),
      lastFour: normalized.slice(-4),
    })
    .onConflictDoUpdate({
      target: [
        schema.providerCredentials.userId,
        schema.providerCredentials.provider,
      ],
      set: {
        encryptedValue: encryptSecret(normalized),
        lastFour: normalized.slice(-4),
        keyVersion: 1,
        updatedAt: new Date(),
      },
    });
}

export async function deleteOpenAICredential(userId: string) {
  await getDatabase()
    .delete(schema.providerCredentials)
    .where(
      and(
        eq(schema.providerCredentials.userId, userId),
        eq(schema.providerCredentials.provider, OPENAI_PROVIDER),
      ),
    );
}
