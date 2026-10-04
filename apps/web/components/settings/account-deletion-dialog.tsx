"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccountDeletion } from "./use-account-deletion";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
const notice = (
  <>
    {" "}
    <AlertDialogHeader>
      <AlertDialogTitle>Permanently delete your account?</AlertDialogTitle>
      <AlertDialogDescription>
        First export and delete owned workspaces from Workspaces, transfer
        organization ownership, and stop your running agents. Deletion removes
        your account, memberships and stored connections, and immediately
        cancels CoDev subscriptions. It cannot be undone. Private imports and
        shared chats you own are removed for all members. Contributions to
        others’ workspaces and required billing records may remain. External
        provider subscriptions are separate. Deletion does not automatically
        issue a refund.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <p className="text-sm">
      <Link className="underline" href="/gen2">
        Manage workspaces
      </Link>{" "}
      ·{" "}
      <Link className="underline" href="/legal/retention">
        What is retained
      </Link>
    </p>
  </>
);
type State = ReturnType<typeof useAccountDeletion>;
function VerificationFields({ state }: { state: State }) {
  const { sent, token, setToken, confirmation, setConfirmation, busy, submit } =
    state;
  return (
    <>
      {" "}
      {sent ? (
        <div className="space-y-3">
          <p className="text-sm" role="status">
            Verification email sent. Copy the code here within 15 minutes.
          </p>
          <label className="block space-y-1 text-sm">
            Email verification code
            <Input
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              disabled={busy}
            />
          </label>
          <label className="block space-y-1 text-sm">
            Type DELETE to confirm
            <Input
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={busy}
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void submit("POST")}
          >
            Resend verification email
          </Button>
        </div>
      ) : (
        <p className="text-sm">
          We’ll send a verification code to the email on your account before
          anything is deleted.
        </p>
      )}
    </>
  );
}
function DeletionActions({ state }: { state: State }) {
  const { sent, token, confirmation, busy, submit } = state;
  return (
    <AlertDialogFooter>
      <AlertDialogCancel disabled={busy}>Keep account</AlertDialogCancel>
      <Button
        variant={sent ? "destructive" : "default"}
        disabled={
          busy || (sent && (!token.trim() || confirmation !== "DELETE"))
        }
        onClick={() => void submit(sent ? "DELETE" : "POST")}
      >
        {busy
          ? "Please wait…"
          : sent
            ? "Permanently delete account"
            : "Send verification email"}
      </Button>
    </AlertDialogFooter>
  );
}
export function AccountDeletionDialog() {
  const state = useAccountDeletion();
  const { open, setOpen, busy, error } = state;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="destructive">Delete account</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        {notice}
        <VerificationFields state={state} />
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DeletionActions state={state} />
      </AlertDialogContent>
    </AlertDialog>
  );
}
