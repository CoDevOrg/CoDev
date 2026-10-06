import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms of service" };

const content = (
  <>
    <h1>Terms of service</h1>
    <p>
      These terms govern CoDev’s hosted coding workspaces, collaboration tools
      and related services at trycodev.com. “CoDev,” “we” and “us” refer to
      CoDev. By continuing through sign-in or accepting these terms when
      purchasing a plan, you accept these terms. If you act for an organization,
      you must have authority to bind it.
    </p>
    <section>
      <h2>Eligibility and account security</h2>
      <p>
        You must be at least 18 and legally able to enter this agreement.
        Provide accurate account details, protect credentials and use only
        connections, repositories and payment methods you are authorized to use.
        Tell <a href="mailto:admins@trycodev.com">admins@trycodev.com</a>{" "}
        promptly about unauthorized account activity. You are responsible for
        actions you authorize and for managing workspace membership.
      </p>
    </section>
    <section>
      <h2>The service and third-party accounts</h2>
      <p>
        CoDev supplies hosted development environments. Features, compute limits
        and supported providers are described on the pricing page and in the
        product. Provider subscriptions, API usage and third-party products are
        separate unless expressly included. Connecting a provider does not
        transfer its license or remove its usage restrictions. You must comply
        with applicable provider terms and have permission to submit the data
        involved.
      </p>
      <p>
        Agents may read or modify files, execute commands, access networks and
        perform actions using connected permissions. Review their output and
        approve actions carefully. AI output can be inaccurate, insecure or
        similar to others’ content; validate correctness, security and licensing
        before use. Keep independent backups and export important work.
      </p>
    </section>
    <section>
      <h2>Your content and permissions</h2>
      <p>
        You retain rights you hold in submitted content. You grant CoDev the
        limited permissions necessary to host, process, transmit and display it
        to provide and secure your requested features, including transmission to
        selected providers and authorized collaborators. We do not take
        ownership of your source code. Rights in AI output remain subject to
        applicable law and provider terms; uniqueness and non-infringement are
        not guaranteed. Third-party and open-source licenses continue to apply.
      </p>
    </section>
    <section>
      <h2>Acceptable use</h2>
      <p>
        Do not use CoDev for unlawful activity, malware distribution, credential
        theft, unauthorized access, infringement, harassment, exploitation of
        children, or deliberate disruption of others. Do not evade access
        controls, quotas or payment requirements; abuse shared compute; send
        spam; or use resources for unapproved cryptocurrency mining. Security
        testing must be authorized by the affected owner. Report suspected
        vulnerabilities privately to our support address.
      </p>
    </section>
    <section>
      <h2>Subscriptions, cancellation and refunds</h2>
      <p>
        Paid plans are billed monthly in USD at the selected tier price shown at
        checkout. Any applicable taxes and discounts are shown before payment.
        Subscriptions renew automatically until canceled. You authorize
        recurring charges only when confirming the purchase in checkout.
        Provider charges outside CoDev remain your responsibility.
      </p>
      <p>
        Cancel through Settings → Billing → Manage billing before your next
        renewal. Ordinary cancellation keeps access until the displayed
        paid-period end; account deletion ends access immediately. See the{" "}
        <Link href="/legal/refunds">refund and cancellation policy</Link>, which
        forms part of these terms. We will give advance notice of material
        recurring price changes and obtain consent where required.
      </p>
    </section>
    <section>
      <h2>Suspension and ending your account</h2>
      <p>
        We may restrict access when reasonably necessary to address a security
        risk, unlawful use, material breach, unpaid fees or a legal requirement.
        When practical, we will explain the issue and provide a way to resolve
        it; urgent risks may require immediate action. You may stop using the
        service, cancel billing, or delete your account through Settings →
        Profile. Export your work first. Shared contributions, necessary records
        and third-party copies may remain as explained in the{" "}
        <Link href="/legal/privacy">privacy policy</Link>.
      </p>
    </section>
    <section>
      <h2>Availability and responsibility</h2>
      <p>
        We aim to operate a reliable service, but do not guarantee uninterrupted
        access, error-free software or accurate AI output. To the extent
        permitted by law, the service is provided as available without
        additional implied warranties. Nothing excludes mandatory consumer
        guarantees or responsibility that cannot lawfully be excluded.
      </p>
      <p>
        To the extent permitted by law, neither party is liable for indirect or
        consequential losses that were not reasonably foreseeable when the
        agreement was made. These terms do not limit liability for fraud,
        willful misconduct, gross negligence, death or personal injury caused by
        negligence, or any liability that the law does not permit us to limit.
      </p>
    </section>
    <section>
      <h2>Disputes, changes and contact</h2>
      <p>
        Contact <a href="mailto:admins@trycodev.com">admins@trycodev.com</a> so
        we can try to resolve a concern. This does not restrict access to your
        card issuer, regulator, consumer agency or courts, or shorten statutory
        deadlines. Mandatory protections in your jurisdiction continue to apply.
        These terms do not impose mandatory arbitration or waive class-action
        rights.
      </p>
      <p>
        We will post updated terms with a revision date and notify you of
        material changes before they take effect where required. Changes do not
        retroactively remove accrued rights. If a provision is unenforceable,
        the remaining provisions continue to apply to the extent lawful. Contact
        the operator below for notices and support.
      </p>
    </section>
  </>
);

export default function TermsPage() {
  return content;
}
