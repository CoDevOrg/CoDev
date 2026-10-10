"use client";

import { useActionState } from "react";
import Image from "next/image";

import {
  confirmTwoFactorAction,
  type TwoFactorActionState,
} from "@/app/actions/two-factor";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { RecoveryCodes } from "./recovery-codes";

/** Scan or type the secret, then prove it works with a first code. */
export function TwoFactorSetup({
  secret,
  qrSvg,
  onCancel,
  onDone,
}: {
  secret: string;
  qrSvg: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<
    TwoFactorActionState,
    FormData
  >(confirmTwoFactorAction, { status: "idle" });
  if (state.status === "codes")
    return <RecoveryCodes codes={state.recoveryCodes} onDone={onDone} />;

  return (
    <div className="flex flex-col gap-4">
      <ol className="m-0 flex flex-col gap-1 pl-5 text-sm text-muted-foreground [list-style:decimal]">
        <li>
          Open an authenticator app such as 1Password, Authy, or Google
          Authenticator.
        </li>
        <li>Scan this QR code, or enter the setup key by hand.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-4">
        {/* Authenticator cameras need dark modules on light, in either theme. */}
        <Image
          alt="QR code for your authenticator app"
          className="size-40 rounded-lg bg-white p-2"
          height={160}
          src={`data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`}
          unoptimized
          width={160}
        />
        <Field className="min-w-0 flex-1">
          <FieldLabel htmlFor="totp-secret">Setup key</FieldLabel>
          <code
            className="block rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm break-all select-all"
            id="totp-secret"
          >
            {secret.match(/.{1,4}/g)?.join(" ")}
          </code>
          <FieldDescription>Time-based, 6 digits, 30 seconds.</FieldDescription>
        </Field>
      </div>
      <form action={action} className="flex flex-col gap-3">
        {state.status === "error" ? (
          <Alert role="alert" variant="destructive">
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}
        <Field className="max-w-xs">
          <FieldLabel htmlFor="totp-password">Current password</FieldLabel>
          <Input
            autoComplete="current-password"
            id="totp-password"
            name="password"
            required
            type="password"
          />
        </Field>
        <Field className="max-w-xs">
          <FieldLabel htmlFor="totp-confirm">Code from your app</FieldLabel>
          <Input
            autoComplete="one-time-code"
            id="totp-confirm"
            inputMode="numeric"
            maxLength={7}
            name="code"
            pattern="[0-9 ]{6,7}"
            placeholder="123456"
            required
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending} size="sm" type="submit">
            {pending ? "Verifying…" : "Verify and turn on"}
          </Button>
          <Button onClick={onCancel} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
