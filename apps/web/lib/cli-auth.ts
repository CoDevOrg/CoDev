import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, isNull, lt } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "./database";

const DEVICE_TTL_MS = 10 * 60 * 1_000;
const CLI_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1_000;
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class CliAuthError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "CliAuthError";
  }
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function createUserCode() {
  const bytes = randomBytes(8);
  const value = Array.from(bytes, (byte) =>
    USER_CODE_ALPHABET.at(byte % USER_CODE_ALPHABET.length),
  ).join("");
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

export async function createCliDeviceAuthorization(
  input: { clientType?: "cli" | "mobile" } = {},
) {
  const deviceCode = randomBytes(32).toString("base64url");
  const userCode = createUserCode();
  const expiresAt = new Date(Date.now() + DEVICE_TTL_MS);
  await getDatabase()
    .delete(schema.cliDeviceAuthorizations)
    .where(lt(schema.cliDeviceAuthorizations.expiresAt, new Date()));
  await getDatabase()
    .insert(schema.cliDeviceAuthorizations)
    .values({
      deviceCodeHash: hash(deviceCode),
      userCode,
      clientType: input.clientType ?? "cli",
      expiresAt,
    });
  return { deviceCode, userCode, expiresAt };
}

export async function approveCliDeviceAuthorization(input: {
  userCode: string;
  userId: string;
}) {
  const [approved] = await getDatabase()
    .update(schema.cliDeviceAuthorizations)
    .set({
      status: "approved",
      approvedBy: input.userId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(
          schema.cliDeviceAuthorizations.userCode,
          input.userCode.trim().toUpperCase(),
        ),
        eq(schema.cliDeviceAuthorizations.status, "pending"),
        gt(schema.cliDeviceAuthorizations.expiresAt, new Date()),
        isNull(schema.cliDeviceAuthorizations.consumedAt),
      ),
    )
    .returning({ id: schema.cliDeviceAuthorizations.id });
  if (!approved) {
    throw new CliAuthError("This CLI code is invalid or expired.", 404);
  }
}

export async function mintCliAccessToken(
  userId: string,
  clientType: "cli" | "mobile",
  database: Pick<ReturnType<typeof getDatabase>, "insert"> = getDatabase(),
) {
  const rawToken = `codev_cli_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + CLI_TOKEN_TTL_MS);
  await database.insert(schema.cliAccessTokens).values({
    userId,
    tokenHash: hash(rawToken),
    clientType,
    name: clientType === "mobile" ? "CoDev Mobile" : "CoDev CLI",
    expiresAt,
  });
  return { token: rawToken, expiresAt };
}

export async function exchangeCliDeviceAuthorization(deviceCode: string) {
  if (!deviceCode) throw new CliAuthError("Device code is required.");
  return getDatabase().transaction(async (transaction) => {
    const [authorization] = await transaction
      .update(schema.cliDeviceAuthorizations)
      .set({ consumedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.cliDeviceAuthorizations.deviceCodeHash, hash(deviceCode)),
          eq(schema.cliDeviceAuthorizations.status, "approved"),
          gt(schema.cliDeviceAuthorizations.expiresAt, new Date()),
          isNull(schema.cliDeviceAuthorizations.consumedAt),
        ),
      )
      .returning({
        userId: schema.cliDeviceAuthorizations.approvedBy,
        clientType: schema.cliDeviceAuthorizations.clientType,
      });
    if (!authorization?.userId) return null;

    return mintCliAccessToken(authorization.userId, authorization.clientType, transaction);
  });
}

export async function authenticateCliRequest(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(codev_cli_[A-Za-z0-9_-]+)$/.exec(authorization);
  if (!match?.[1]) throw new CliAuthError("CLI login is required.", 401);
  const [token] = await getDatabase()
    .select({
      id: schema.cliAccessTokens.id,
      userId: schema.cliAccessTokens.userId,
    })
    .from(schema.cliAccessTokens)
    .where(
      and(
        eq(schema.cliAccessTokens.tokenHash, hash(match[1])),
        gt(schema.cliAccessTokens.expiresAt, new Date()),
        isNull(schema.cliAccessTokens.revokedAt),
      ),
    )
    .limit(1);
  if (!token) throw new CliAuthError("CLI login is invalid or expired.", 401);
  await getDatabase()
    .update(schema.cliAccessTokens)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.cliAccessTokens.id, token.id));
  return token;
}

export function cliAuthErrorResponse(error: unknown) {
  if (error instanceof CliAuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({ error: "The CLI request failed." }, { status: 500 });
}
