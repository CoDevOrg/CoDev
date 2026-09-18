import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export type PasswordResetState = {
  userId: string;
  email: string;
  fingerprint: string;
  expiresAt: number;
  nonce: string;
};

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is required for password reset.");
  }
  return secret;
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signatureFor(payload: string) {
  return createHmac("sha256", getAuthSecret())
    .update(payload)
    .digest("base64url");
}

export function passwordResetFingerprint(passwordHash: string) {
  return createHash("sha256")
    .update(passwordHash)
    .digest("base64url")
    .slice(0, 24);
}

export function shouldSendPasswordReset(
  user: {
    email: string | null;
    passwordHash: string | null;
  } | null,
) {
  return Boolean(user?.email && user.passwordHash);
}

export function getPublicAppOrigin(
  env: Record<string, string | undefined> = process.env,
) {
  const explicit = env.AUTH_URL ?? env.NEXTAUTH_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function createPasswordResetToken(input: {
  userId: string;
  email: string;
  passwordHash: string;
}) {
  const state: PasswordResetState = {
    userId: input.userId,
    email: input.email.trim().toLowerCase(),
    fingerprint: passwordResetFingerprint(input.passwordHash),
    expiresAt: Date.now() + PASSWORD_RESET_TTL_MS,
    nonce: randomBytes(16).toString("hex"),
  };
  const payload = encode(JSON.stringify(state));
  return `${payload}.${signatureFor(payload)}`;
}

export function openPasswordResetToken(
  value: string,
): PasswordResetState | null {
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [payload, providedSignature] = parts;
  if (!payload || !providedSignature) return null;

  let expectedSignature: string;
  try {
    expectedSignature = signatureFor(payload);
  } catch {
    return null;
  }
  const provided = Buffer.from(providedSignature, "base64url");
  const expected = Buffer.from(expectedSignature, "base64url");
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return null;
  }

  try {
    const state = JSON.parse(decode(payload)) as Partial<PasswordResetState>;
    if (
      typeof state.userId !== "string" ||
      !state.userId ||
      typeof state.email !== "string" ||
      !state.email ||
      typeof state.fingerprint !== "string" ||
      !state.fingerprint ||
      typeof state.expiresAt !== "number" ||
      state.expiresAt <= Date.now() ||
      typeof state.nonce !== "string" ||
      !state.nonce
    ) {
      return null;
    }
    return state as PasswordResetState;
  } catch {
    return null;
  }
}

export function passwordResetTokenStillValid(
  state: PasswordResetState,
  user: {
    id: string;
    email: string | null;
    passwordHash: string | null;
  } | null,
) {
  if (!user?.email || !user.passwordHash) return false;
  return (
    user.id === state.userId &&
    user.email.trim().toLowerCase() === state.email &&
    passwordResetFingerprint(user.passwordHash) === state.fingerprint
  );
}
