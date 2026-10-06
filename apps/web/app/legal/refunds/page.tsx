import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Refunds and cancellation" };

const content = (
  <>
    <h1>Refunds, cancellation and payment disputes</h1>
    <section>
      <h2>What you purchase</h2>
      <p>
        A paid subscription provides the CoDev features and limits shown for the
        selected tier on our <Link href="/pricing">pricing page</Link>. It
        renews monthly at the amount and currency displayed in Stripe Checkout
        until canceled. Separate AI-provider subscriptions and API charges are
        not included unless expressly stated.
      </p>
    </section>
    <section>
      <h2>Cancel future renewals</h2>
      <p>
        Open Settings → Billing → Manage billing and select cancellation in
        Stripe’s customer portal. Complete the confirmation and check the end
        date displayed in Settings. Cancel before the next renewal to prevent
        that charge. You keep access until the paid period ends unless you
        choose account deletion. If the portal is unavailable, email{" "}
        <a href="mailto:admins@trycodev.com">admins@trycodev.com</a> with your
        account email and cancellation request.
      </p>
      <p>
        Deleting a workspace or disconnecting an AI provider does not cancel
        CoDev billing. Successfully deleting your CoDev account immediately
        cancels its CoDev subscriptions and ends access. It does not cancel
        subscriptions held directly with AI providers or other third parties.
      </p>
    </section>
    <section>
      <h2>Request a refund</h2>
      <p>
        Contact <a href="mailto:admins@trycodev.com">admins@trycodev.com</a>{" "}
        with your account email, invoice or receipt identifier, charge date and
        reason. Do not email full card numbers, passwords or API keys. We review
        refund requests individually, including duplicate charges, billing
        errors, unauthorized charges and service problems. Cancellation and
        account deletion do not automatically refund past charges or unused
        time.
      </p>
      <p>
        Refunds required by law remain available regardless of this policy.
        Statutory withdrawal rights, consumer guarantees and remedies for
        defective or undelivered services take priority. Contact us promptly if
        you wish to exercise a withdrawal right; no wording here requires you to
        waive it. Any promotional refund promise shown when you purchased also
        applies.
      </p>
      <p>
        If approved, a refund is submitted through Stripe to the original
        payment method where supported. Bank processing times vary; a submitted
        refund may take several business days to appear. We will tell you the
        approved amount and whether the subscription is also canceled. A refund
        alone is not a substitute for confirming cancellation.
      </p>
    </section>
    <section>
      <h2>Unrecognized charges and chargebacks</h2>
      <p>
        If you do not recognize a charge, contact us so we can investigate. You
        may also contact your payment provider directly and retain all rights
        and deadlines for disputing charges. You do not have to contact us first
        or withdraw a dispute to exercise your legal rights.
      </p>
      <p>
        For an open dispute, we coordinate with Stripe and the card issuer to
        avoid duplicate reimbursement. We may provide relevant transaction
        details, subscription terms, acceptance records and service/cancellation
        history to resolve it. We do not impose an automatic penalty for filing
        a dispute. Any restriction of service must be proportionate to an actual
        payment or security issue.
      </p>
    </section>
    <section>
      <h2>Billing support</h2>
      <p>
        Invoices and payment-method changes are available from Settings →
        Billing → Manage billing. Email{" "}
        <a href="mailto:admins@trycodev.com">admins@trycodev.com</a> if you
        cannot sign in or need help with cancellation, a refund, a payment
        dispute or a consumer-rights request.
      </p>
    </section>
  </>
);

export default function RefundPolicyPage() {
  return content;
}
