"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import {
  disableTwoFactorAction,
  regenerateRecoveryCodesAction,
  startTwoFactorAction,
  type TwoFactorActionState,
} from "@/app/actions/two-factor";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { RecoveryCodes } from "./recovery-codes";
import { useSettingsNotify } from "./settings-feedback";
import { TwoFactorCodeDialog } from "./two-factor-code-dialog";
import { TwoFactorSetup } from "./two-factor-setup";

type View =
  | { kind: "status" }
  | { kind: "setup"; secret: string; qrSvg: string }
  | { kind: "codes"; codes: string[] };

export function TwoFactorPanel({
  enabled,
  hasPassword,
  recoveryCodesRemaining,
}: {
  enabled: boolean;
  hasPassword: boolean;
  recoveryCodesRemaining: number;
}) {
  const router = useRouter();
  const notify = useSettingsNotify();
  const [view, setView] = useState<View>({ kind: "status" });
  const [error, setError] = useState<string | null>(null);
  const [starting, startTransition] = useTransition();
  const finish = useCallback(() => {
    setView({ kind: "status" });
    router.refresh();
  }, [router]);

  const onManageResult = useCallback(
    (state: TwoFactorActionState) => {
      if (state.status === "codes")
        setView({ kind: "codes", codes: state.recoveryCodes });
      if (state.status === "disabled") {
        notify?.("Two-factor authentication is off.");
        router.refresh();
      }
    },
    [notify, router],
  );

  if (view.kind === "setup")
    return (
      <TwoFactorSetup
        hasPassword={hasPassword}
        onCancel={() => setView({ kind: "status" })}
        onDone={() => {
          notify?.("Two-factor authentication is on.");
          finish();
        }}
        qrSvg={view.qrSvg}
        secret={view.secret}
      />
    );
  if (view.kind === "codes")
    return <RecoveryCodes codes={view.codes} onDone={finish} />;

  if (!enabled)
    return (
      <div className="flex flex-col gap-3">
        {error ? (
          <Alert role="alert" variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          className="w-fit"
          disabled={starting}
          onClick={() =>
            startTransition(async () => {
              const state = await startTwoFactorAction();
              if (state.status === "setup") {
                setError(null);
                setView({
                  kind: "setup",
                  secret: state.secret,
                  qrSvg: state.qrSvg,
                });
              } else if (state.status === "error") setError(state.message);
            })
          }
          size="sm"
          type="button"
        >
          <ShieldCheck aria-hidden data-icon="inline-start" />
          {starting ? "Preparing…" : "Set up authenticator app"}
        </Button>
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm text-muted-foreground">
        {recoveryCodesRemaining} of 10 recovery codes left.
        {recoveryCodesRemaining <= 3 ? " Generate new ones soon." : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <TwoFactorCodeDialog
          confirmLabel="Generate codes"
          description="Your old recovery codes stop working. Enter a current code to continue."
          onResult={onManageResult}
          serverAction={regenerateRecoveryCodesAction}
          title="Generate new recovery codes"
          trigger="New recovery codes"
        />
        <TwoFactorCodeDialog
          confirmLabel="Turn off"
          description="Signing in will only need your password or Google/GitHub. Enter a current code to confirm."
          destructive
          onResult={onManageResult}
          serverAction={disableTwoFactorAction}
          title="Turn off two-factor authentication"
          trigger="Turn off"
        />
      </div>
    </div>
  );
}
