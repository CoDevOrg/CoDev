import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy policy" };

const content = (
  <>
    <h1>Privacy policy</h1>
    <p>
      This policy describes how CoDev handles personal information when you
      visit trycodev.com, join our waitlist, create an account, connect
      providers, pay for a plan, or use hosted coding and collaboration
      features. Contact{" "}
      <a href="mailto:admins@trycodev.com">admins@trycodev.com</a> with privacy
      questions or requests.
    </p>
    <section>
      <h2>Information we collect and why</h2>
      <ul>
        <li>
          <strong>Identity and access:</strong> name, email, profile image,
          account IDs and usernames from you or Google/GitHub sign-in; a
          password hash if you use a password; invitations, memberships and
          device authorization records. We use these to create accounts,
          authenticate you, control access and prevent abuse.
        </li>
        <li>
          <strong>Your work:</strong> repositories you connect, source files,
          workspace disks, imported conversations, prompts, chat history,
          attachments, agent output, commands and collaboration activity. We
          process these to run your workspaces and the features you request.
        </li>
        <li>
          <strong>Connections and secrets:</strong> provider access/refresh
          tokens, API keys, official CLI authentication material and environment
          variables you supply. Stored credential material is encrypted;
          authorized backend and runtime processes need access to use your
          connections. Only connect accounts and repositories you are authorized
          to use.
        </li>
        <li>
          <strong>Billing:</strong> Stripe customer and subscription IDs, plan,
          payment status and billing dates. Stripe collects payment and billing
          details directly; CoDev does not receive full card numbers. We use
          billing records to provide paid access, handle refunds, accounting and
          disputes.
        </li>
        <li>
          <strong>Support and waitlist:</strong> contact information, feedback,
          access requests and information you send us, used to respond, invite
          you and operate the service. Email service providers process delivery
          and correspondence.
        </li>
        <li>
          <strong>Technical and usage information:</strong> requests, IP
          addresses visible to our infrastructure, security logs, errors,
          browser/device information and compute usage. With optional analytics
          enabled, we also record page visits, referrer origin and an IP-derived
          hash, which may be associated with your signed-in account. We use this
          to understand usage and improve the service.
        </li>
      </ul>
    </section>
    <section>
      <h2>AI providers and shared workspaces</h2>
      <p>
        When you run an agent, relevant prompts, files, conversation history and
        tool results are sent to the provider selected for that task, such as
        OpenAI, Anthropic, Cursor, Microsoft Azure AI Foundry or Amazon Bedrock,
        including through accounts you connect. Their handling, retention and
        any training use depend on that provider, product and your account
        settings. Review those terms before sending confidential or personal
        information. We do not promise that third-party services retain no data.
      </p>
      <p>
        Members with access to a shared workspace or chat can see content
        available there, including agent output and files. Agents can execute
        commands and contact external services. Do not put secrets or
        information you cannot share in shared content. Removing a member cannot
        recall copies others already downloaded.
      </p>
    </section>
    <section>
      <h2>Who receives information</h2>
      <p>
        We use service providers for hosting and execution (including Vercel and
        Microsoft Azure), database/storage (Supabase/PostgreSQL) and Redis
        infrastructure, payment processing (Stripe), transactional email
        (Resend), and inbound support email forwarding (ImprovMX and the
        receiving mail service). Google and GitHub receive information needed
        for sign-in and connected features. AI providers receive the task
        information described above. The providers involved depend on the
        features and connections you use.
      </p>
      <p>
        We may disclose necessary information to comply with law, protect people
        and the service, investigate abuse, resolve payment disputes, or support
        a business transfer subject to appropriate confidentiality and legal
        safeguards. We do not sell personal information or share it for
        cross-context behavioral advertising.
      </p>
    </section>
    <section>
      <h2>Cookies and choices</h2>
      <p>
        Essential cookies support sign-in, security and your privacy preference.
        Local browser storage also remembers interface preferences. Optional
        analytics remains off until you choose “Allow analytics.” You can reject
        it or change your choice using Privacy choices at any time. Global
        Privacy Control and Do Not Track signals disable optional analytics. See
        our <Link href="/legal/cookies">cookie notice</Link>.
      </p>
    </section>
    <section>
      <h2>Retention and deletion</h2>
      <p>
        We keep account and workspace data for the period needed to provide the
        service. Deleting a workspace removes its active workspace records and
        invokes cloud disk/snapshot cleanup. Account deletion removes your
        profile, stored personal connections, environment variables, private
        imported conversations and access tokens; shared contributions may
        remain attributed to “Deleted account.” Billing, security, legal and
        backup records may remain where necessary. See{" "}
        <Link href="/legal/retention">data retention</Link> for the limits and
        process.
      </p>
    </section>
    <section>
      <h2>Your privacy rights</h2>
      <p>
        Depending on your location and applicable law, you may request access, a
        copy, correction, deletion, restriction or portability of your
        information; object to processing; withdraw consent; or appeal a
        decision. These rights have legal exceptions. We do not penalize you for
        exercising them. California residents may also have rights to opt out of
        sale/sharing and limit certain uses of sensitive information; we use
        account credentials to provide and secure your requested service.
      </p>
      <p>
        Use Settings → Profile for an account-details download and verified
        account deletion. The download is not a complete personal-data export.
        For a broader request, an authorized-agent request, an appeal, or help
        accessing your account, email{" "}
        <a href="mailto:admins@trycodev.com">admins@trycodev.com</a>. We verify
        identity proportionately, respond within applicable legal deadlines, and
        explain any refusal or permitted extension. You may complain to your
        local privacy regulator.
      </p>
    </section>
    <section>
      <h2>International processing and legal bases</h2>
      <p>
        Our service providers may process information in countries other than
        yours, including the United States, where privacy protections differ.
        Where required, transfers must be supported by applicable legal
        safeguards. If European or UK data-protection law applies, we rely on
        contract for requested account/workspace and billing services,
        legitimate interests for proportionate security, support and service
        operation, legal obligations for required records, and consent for
        optional analytics where required. You may withdraw consent without
        affecting earlier lawful processing.
      </p>
    </section>
    <section>
      <h2>Security, age and changes</h2>
      <p>
        We use access controls, encryption for stored credentials and other
        technical protections, but no system is guaranteed secure. CoDev
        accounts are intended for adults aged 18 or older. Contact us if you
        believe a child has provided personal information. We publish policy
        changes here and provide additional notice or obtain consent when
        required for material changes.
      </p>
    </section>
  </>
);

export default function PrivacyPolicyPage() {
  return content;
}
