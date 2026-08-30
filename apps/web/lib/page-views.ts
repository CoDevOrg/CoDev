import "server-only";

import { createHash } from "node:crypto";

import { schema } from "@codev/db";

import { getDatabase } from "./database";

/** Longest path / referrer / UA we will persist. Anything longer is truncated. */
const MAX_TEXT = 2048;

function clamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_TEXT ? trimmed.slice(0, MAX_TEXT) : trimmed;
}

/**
 * Salted digest of the caller's address — never the raw address. Mirrors the
 * approach in the access-request endpoint so anonymous visitors can be counted
 * as distinct without storing PII.
 */
export function hashCallerAddress(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  const address =
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim();
  if (!address) return null;
  const salt = process.env.AUTH_SECRET ?? "codev-page-view";
  return createHash("sha256").update(`${salt}:${address}`).digest("hex");
}

export type RecordPageViewInput = {
  path: string;
  userId?: string | null;
  referrer?: string | null;
  userAgent?: string | null;
  ipHash?: string | null;
};

/**
 * Persists one page view. Best-effort: callers invoke this from a fire-and-
 * forget beacon handler, so a write failure must never surface to the visitor.
 */
export async function recordPageView(
  input: RecordPageViewInput,
): Promise<void> {
  const path = clamp(input.path);
  if (!path || !path.startsWith("/")) return;

  try {
    await getDatabase()
      .insert(schema.pageViews)
      .values({
        path,
        userId: input.userId ?? null,
        referrer: clamp(input.referrer),
        userAgent: clamp(input.userAgent),
        ipHash: input.ipHash ?? null,
      });
  } catch (error) {
    console.error("Failed to record page view", error);
  }
}
