import "server-only";

import { schema } from "@codev/db";
import { and, eq } from "drizzle-orm";

import { readGen2PreviewConfig } from "../gen2/preview-config";
import { getDatabase } from "../platform/database";
import { logEvent } from "../platform/observability";
import { cloudflareRequestDirect } from "./arm-workspace-provider";
import {
  armWorkspacePreviewSuffix,
  isArmWorkspacePreviewHost,
} from "./arm-workspace-preview-route";

/** The every-minute cron sweeps at most this often per process. */
const INTERVAL_MS = 5 * 60_000;
const PAGE_SIZE = 100;
const MAX_DELETES = 20;
/** Leave records a mint may have created after the ready set was read. */
const MIN_AGE_MS = 2 * 60_000;

type DnsRecord = {
  id: string;
  name: string;
  content: string;
  created_on?: string;
};

let nextRunAt = 0;
let nextPage = 1;

async function readySuffixes(zone: string) {
  const rows = await getDatabase()
    .select({
      id: schema.gen2Workspaces.id,
      generation: schema.gen2Workspaces.runtimeGeneration,
    })
    .from(schema.gen2Workspaces)
    .where(
      and(
        eq(schema.gen2Workspaces.runtimeProvider, "azure_arm"),
        eq(schema.gen2Workspaces.runtimeStatus, "ready"),
      ),
    );
  return new Set(
    await Promise.all(
      rows.map((row) =>
        armWorkspacePreviewSuffix(row.id, row.generation, zone),
      ),
    ),
  );
}

/**
 * Deletes preview DNS records whose workspace generation is no longer the
 * ready one: stopped, restarted, and deleted workspaces would otherwise use
 * up the zone's record quota. Bounded to one page and a few deletes per run,
 * paging through the zone across runs; failures wait for the next run.
 */
export async function sweepArmWorkspacePreviewRoutes(now = Date.now()) {
  const config = readGen2PreviewConfig();
  if (!config || now < nextRunAt) return { deleted: 0 };
  nextRunAt = now + INTERVAL_MS;
  try {
    const records = await cloudflareRequestDirect<DnsRecord[]>(
      `/zones/${config.zoneId}/dns_records?type=CNAME&per_page=${PAGE_SIZE}&page=${nextPage}`,
    );
    nextPage = records.length < PAGE_SIZE ? 1 : nextPage + 1;
    // Read after listing, so any record listed predates this ready set.
    const ready = await readySuffixes(config.zone);
    const stale = records
      .filter(
        (record) =>
          isArmWorkspacePreviewHost(record.name, config.zone) &&
          !ready.has(record.name.slice(record.name.indexOf("-"))) &&
          now - Date.parse(record.created_on ?? "") >= MIN_AGE_MS,
      )
      .slice(0, MAX_DELETES);
    for (const record of stale) {
      await cloudflareRequestDirect(
        `/zones/${config.zoneId}/dns_records/${record.id}`,
        "DELETE",
      );
    }
    return { deleted: stale.length };
  } catch {
    logEvent("warn", "gen2.preview.sweep_failed", { page: nextPage });
    return { deleted: 0 };
  }
}
