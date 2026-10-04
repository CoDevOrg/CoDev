import Link from "next/link";
import { LinkButton } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { AccountDeletionDialog } from "./account-deletion-dialog";

const panel = (
  <Card className="flex flex-col gap-4 p-4">
    <CardHeader>
      <CardTitle>Privacy and account deletion</CardTitle>
      <CardDescription>
        Download your account details or permanently delete your account.
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Export workspace files separately before deleting them. The account
        download includes profile details and connection names, not secrets or
        workspace files. For a full personal data request, email{" "}
        <a className="underline" href="mailto:admins@trycodev.com">
          admins@trycodev.com
        </a>
        .
      </p>
      <div className="flex flex-wrap gap-3">
        <LinkButton variant="outline" href="/api/settings/export">
          Download account details
        </LinkButton>
        <AccountDeletionDialog />
      </div>
      <p className="text-sm">
        <Link className="underline" href="/legal/privacy">
          Privacy policy
        </Link>{" "}
        ·{" "}
        <Link className="underline" href="/legal/terms">
          Terms of service
        </Link>{" "}
        ·{" "}
        <Link className="underline" href="/legal/refunds">
          Refunds and cancellation
        </Link>
      </p>
    </CardContent>
  </Card>
);
export function DeleteAccountPanel() {
  return panel;
}
