"use server";

import { revalidatePath } from "next/cache";

import { confirmCurrentPassword } from "@/lib/auth/current-password";
import { requireUser } from "@/lib/auth/session";
import {
  confirmTwoFactorSetup,
  disableTwoFactor,
  regenerateRecoveryCodes,
  startTwoFactorSetup,
  TwoFactorError,
} from "@/lib/auth/two-factor";

const SECURITY_PATH = "/settings/personal/security";

export type TwoFactorActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "setup"; secret: string; qrSvg: string }
  | { status: "codes"; recoveryCodes: string[] }
  | { status: "disabled" };

const MESSAGES: Record<TwoFactorError["reason"], string> = {
  already_enabled: "Two-factor authentication is already on.",
  not_enabled: "Two-factor authentication is not on.",
  no_setup: "Setup expired. Start again.",
  invalid_code:
    "That code did not work. Enter the current 6-digit code or an unused recovery code.",
  rate_limited: "Too many codes tried. Wait 15 minutes and try again.",
};

async function run(
  action: () => Promise<TwoFactorActionState>,
): Promise<TwoFactorActionState> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof TwoFactorError)
      return { status: "error", message: MESSAGES[error.reason] };
    throw error;
  }
}

const code = (formData: FormData) => String(formData.get("code") ?? "").trim();

export async function startTwoFactorAction(): Promise<TwoFactorActionState> {
  const user = await requireUser();
  return run(async () => {
    const { secret, qrSvg } = await startTwoFactorSetup(
      user.id,
      user.email ?? user.name ?? "CoDev account",
    );
    return { status: "setup", secret, qrSvg };
  });
}

export async function confirmTwoFactorAction(
  _: TwoFactorActionState,
  formData: FormData,
): Promise<TwoFactorActionState> {
  const user = await requireUser();
  // Turning 2FA on re-confirms the password: otherwise a stolen session
  // could add its own authenticator and lock the owner out.
  const current = await confirmCurrentPassword(
    user.id,
    String(formData.get("password") ?? ""),
  );
  if (!current.ok) return { status: "error", message: current.message };
  const state = await run(async () => {
    const recoveryCodes = await confirmTwoFactorSetup(user.id, code(formData));
    revalidatePath(SECURITY_PATH);
    return { status: "codes", recoveryCodes };
  });
  // Setup has no recovery codes yet; point at the usual cause instead.
  return state.status === "error" && state.message === MESSAGES.invalid_code
    ? {
        status: "error",
        message:
          "That code did not work. Enter the code your app shows now, and check that your phone's clock is set automatically.",
      }
    : state;
}

export async function disableTwoFactorAction(
  _: TwoFactorActionState,
  formData: FormData,
): Promise<TwoFactorActionState> {
  const user = await requireUser();
  return run(async () => {
    await disableTwoFactor(user.id, code(formData));
    revalidatePath(SECURITY_PATH);
    return { status: "disabled" };
  });
}

export async function regenerateRecoveryCodesAction(
  _: TwoFactorActionState,
  formData: FormData,
): Promise<TwoFactorActionState> {
  const user = await requireUser();
  return run(async () => {
    const recoveryCodes = await regenerateRecoveryCodes(
      user.id,
      code(formData),
    );
    revalidatePath(SECURITY_PATH);
    return { status: "codes", recoveryCodes };
  });
}
