import "server-only";

import { timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@codev/db";
import type { Gen2AgentProviderName, Gen2ModelInfo } from "@codev/contracts";
import { getDatabase } from "../platform/database";
import { runtimeEnvironment } from "../platform/runtime-environment";
import { Gen2LifecycleError } from "./errors";

/**
 * Bridges the gap between a provider shipping a model and the next image
 * carrying a CLI that can run it: turns fall back to the closest model the
 * live CLI supports and say so, and the CLI updater ships a satisfying CLI.
 * Codex needs none of this, because its catalog is already filtered by the
 * promoted image's version (CODEX_CATALOG_CLIENT_VERSION).
 */
const TOO_OLD: Partial<Record<Gen2AgentProviderName, RegExp>> = {
  claude:
    /Claude Code (\d+\.\d+\.\d+) does not support this model; version (\d+\.\d+\.\d+) or newer is required/,
};
const CLI_NAME: Partial<Record<Gen2AgentProviderName, string>> = {
  claude: "claude-code",
};
const CLI_LABEL: Partial<Record<Gen2AgentProviderName, string>> = {
  claude: "Claude Code",
};

export type CliModelRequirement = {
  observedVersion: string;
  minVersion: string;
};

/** The CLI-too-old failure a turn ended with, if that is what it was. */
export function cliModelRequirement(
  provider: string,
  error: string | null | undefined,
): CliModelRequirement | null {
  const pattern = TOO_OLD[provider as Gen2AgentProviderName];
  const match = pattern && error ? error.match(pattern) : null;
  return match ? { observedVersion: match[1]!, minVersion: match[2]! } : null;
}

const family = (model: string) =>
  model.match(/^(?:claude-)?(opus|sonnet|haiku)/)?.[1] ?? null;

/** Catalogs list newest first, so the first same-family survivor is closest. */
export function closestFallbackModel(
  model: string,
  models: Gen2ModelInfo[],
  blocked: { has(model: string): boolean },
) {
  const usable = models
    .map(({ id }) => id)
    .filter((id) => id !== model && !blocked.has(id));
  return usable.find((id) => family(id) === family(model)) ?? usable[0] ?? null;
}

export function fallbackNote(input: {
  provider: string;
  from: string;
  to: string | null;
  requirement: CliModelRequirement;
}) {
  const cli = CLI_LABEL[input.provider as Gen2AgentProviderName] ?? "This CLI";
  const reason = `${input.from} needs ${cli} ${input.requirement.minVersion} or newer, and this workspace has ${input.requirement.observedVersion}. Workspaces are being updated now.`;
  return input.to
    ? `${reason} Answering with ${input.to} in the meantime.`
    : `${reason} No other model on your account can run here yet; try again once the update is live.`;
}

const currentImage = () =>
  runtimeEnvironment().ARM_WORKSPACE_IMAGE_VERSION_ID?.trim() || null;

export async function recordCliModelRequirement(input: {
  provider: string;
  model: string;
  requirement: CliModelRequirement;
}) {
  const values = {
    minVersion: input.requirement.minVersion,
    observedVersion: input.requirement.observedVersion,
    imageVersionId: currentImage(),
    updatedAt: new Date(),
  };
  await getDatabase()
    .insert(schema.agentCliModelRequirements)
    .values({ provider: input.provider, model: input.model, ...values })
    .onConflictDoUpdate({
      target: [
        schema.agentCliModelRequirements.provider,
        schema.agentCliModelRequirements.model,
      ],
      set: values,
    });
}

/** Requirements observed on the promoted image; a newer image retries them. */
async function openRequirements(provider?: string) {
  const image = currentImage();
  return getDatabase()
    .select()
    .from(schema.agentCliModelRequirements)
    .where(
      and(
        image
          ? eq(schema.agentCliModelRequirements.imageVersionId, image)
          : sql`${schema.agentCliModelRequirements.imageVersionId} is null`,
        provider
          ? eq(schema.agentCliModelRequirements.provider, provider)
          : undefined,
      ),
    );
}

/** Models this provider's live CLI cannot run, with what each needs. */
export async function blockedCliModels(provider: string) {
  return new Map<string, CliModelRequirement>(
    (await openRequirements(provider)).map((row) => [
      row.model,
      { observedVersion: row.observedVersion, minVersion: row.minVersion },
    ]),
  );
}

/** `claude-code=2.1.280`-style requirements for the CLI updater. */
export async function cliUpdateRequirements() {
  const highest = new Map<string, string>();
  for (const row of await openRequirements()) {
    const cli = CLI_NAME[row.provider as Gen2AgentProviderName];
    const previous = cli && highest.get(cli);
    if (cli && (!previous || newer(row.minVersion, previous)))
      highest.set(cli, row.minVersion);
  }
  return [...highest].map(([cli, version]) => `${cli}=${version}`);
}

function newer(a: string, b: string) {
  const [x, y] = [a, b].map((value) => value.split(".").map(Number));
  for (let index = 0; index < 3; index++) {
    const difference = (x?.[index] ?? 0) - (y?.[index] ?? 0);
    if (difference) return difference > 0;
  }
  return false;
}

/** Picks the model a new turn should run on, and the note if it changed. */
export async function avoidBlockedCliModel(
  provider: string,
  model: string,
  models: Gen2ModelInfo[],
) {
  const blocked = await blockedCliModels(provider);
  const requirement = blocked.get(model);
  if (!requirement) return { model, note: null };
  const to = closestFallbackModel(model, models, blocked);
  return {
    model: to,
    note: fallbackNote({ provider, from: model, to, requirement }),
  };
}

/** The CLI updater authenticates with the shared service secret. */
export async function cliUpdateRequirementsForService(request: Request) {
  const secret = runtimeEnvironment().CRON_SECRET;
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(secret ? `Bearer ${secret}` : "");
  if (
    !secret ||
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  )
    throw new Gen2LifecycleError("Unauthorized.", 401);
  return { requirements: await cliUpdateRequirements() };
}
