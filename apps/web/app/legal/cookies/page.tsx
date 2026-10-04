import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cookies and privacy choices" };

const content = (
  <>
    <h1>Cookies and privacy choices</h1>
    <section>
      <h2>Essential storage</h2>
      <p>
        CoDev uses cookies for sign-in sessions, authentication security,
        provider connection flows and invitations. These are needed for
        requested account features. Browser storage remembers choices such as
        your interface theme. The codev_analytics cookie remembers your
        analytics preference for up to six months; you can change it sooner
        using Privacy choices.
      </p>
    </section>
    <section>
      <h2>Optional analytics</h2>
      <p>
        With your permission, we load Vercel Web Analytics and our own visit
        measurement. CoDev visit records include the page path, referrer origin,
        browser information, an IP-derived hash and, when signed in, your
        account ID. We exclude URL queries and fragments from these analytics
        events to reduce collection of tokens and other sensitive information.
        Essential infrastructure may still log requests for service operation
        and security.
      </p>
      <p>
        Optional analytics is off until you choose Allow analytics. Rejecting it
        does not prevent use of the service. Use Privacy choices to withdraw
        consent or change the setting. Global Privacy Control or Do Not Track
        disables optional analytics even if you previously allowed it. These
        choices apply to this browser; clearing storage or using another browser
        may require a new choice.
      </p>
    </section>
    <section>
      <h2>Other services</h2>
      <p>
        Stripe Checkout, sign-in providers, connected tools and websites you
        open from a workspace may use their own cookies and storage. Their
        notices and settings apply when you interact with them. Contact{" "}
        <a href="mailto:admins@trycodev.com">admins@trycodev.com</a> with
        questions.
      </p>
    </section>
  </>
);

export default function CookiesPage() {
  return content;
}
