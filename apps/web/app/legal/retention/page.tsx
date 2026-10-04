import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Data retention and deletion" };

const content = (
  <>
    <h1>Data retention and deletion</h1>
    <section>
      <h2>Active accounts and workspaces</h2>
      <p>
        Account details, memberships, stored connections, environment variables
        and workspace content are kept while needed to provide the service.
        Stopping a workspace preserves its disk so you can resume. Stopping
        compute, canceling a plan or disconnecting a provider does not delete
        workspace files.
      </p>
    </section>
    <section>
      <h2>Delete a workspace</h2>
      <p>
        The owner can delete a workspace from Workspaces. Export files and
        notify collaborators first: deletion removes their access too. The
        deletion process removes active workspace records and requests removal
        of the hosted guest and saved snapshot. A failed cleanup remains
        retryable and is not treated as successful deletion.
      </p>
    </section>
    <section>
      <h2>Delete an account</h2>
      <p>
        In Settings → Profile, choose Delete account, obtain an email
        verification code and confirm deletion. First delete owned workspaces,
        resolve organization ownership, and stop running agents. Contact{" "}
        <a href="mailto:admins@trycodev.com">admins@trycodev.com</a> for help
        with older workspaces, inaccessible email, or any step you cannot
        complete.
      </p>
      <p>
        Successful deletion removes the original account record, password hash,
        linked sign-in identities, personal provider credentials, environment
        variables, GitHub connection, memberships, CLI/device/push tokens,
        personal imported conversations (including shared chats you own) and
        account-linked page-view records. It ends CoDev subscriptions
        immediately and removes the Stripe customer’s saved payment methods.
        Existing sign-in sessions no longer authorize new requests. External
        accounts and subscriptions remain under your control.
      </p>
    </section>
    <section>
      <h2>What can remain</h2>
      <ul>
        <li>
          Contributions to other people’s workspaces and shared histories may
          remain under a replacement “Deleted account” identity. Text, files and
          Git history may still contain information you supplied. Ask us to
          review specific personal information for erasure where applicable;
          account deletion is not a guarantee that every mention in shared
          content disappears.
        </li>
        <li>
          Invoices, transaction identifiers and records necessary for tax,
          accounting, fraud prevention, disputes or legal obligations may remain
          for the applicable required period. Access should be limited to those
          purposes.
        </li>
        <li>
          Infrastructure logs, support correspondence and backups have separate
          retention cycles. Deletion from active systems does not mean immediate
          erasure from every backup. Contact us for the applicable schedule and
          any legal hold affecting your request.
        </li>
        <li>
          Copies held by collaborators, Git hosts, AI providers or other
          services follow their own controls and policies. Deleting CoDev cannot
          recall copies outside our control; we handle service-provider erasure
          requests where required by law.
        </li>
      </ul>
    </section>
    <section>
      <h2>Access and broader requests</h2>
      <p>
        The Settings account download contains profile information and
        connection names, not all personal information or workspace files. For a
        broader access, portability, correction or erasure request, email{" "}
        <a href="mailto:admins@trycodev.com">admins@trycodev.com</a>. We assess
        retained records against applicable law, explain exceptions and respond
        within the relevant legal deadline. See the{" "}
        <Link href="/legal/privacy">privacy policy</Link> and{" "}
        <Link href="/legal/refunds">billing policy</Link>.
      </p>
    </section>
  </>
);

export default function DataRetentionPage() {
  return content;
}
