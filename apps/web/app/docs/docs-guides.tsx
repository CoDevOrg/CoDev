import Link from "next/link";
import { guides } from "./docs-content";
import { AiSubscriptions } from "@/components/landing/ai-subscriptions";

export function DocsGuides() {
  return (
    <div className="docs-guides">
      {guides.map(({ id, title, steps }, index) => (
        <section id={id} className="docs-guide-section" key={id}>
          <p className="docs-eyebrow">0{index + 1} · GUIDE</p>
          <h2>{title}</h2>
          <ol>
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {id === "agents" ? <AiSubscriptions /> : null}
          {id === "getting-started" ? (
            <Link className="docs-inline-link" href="/#get-access">
              Join the waitlist →
            </Link>
          ) : null}
        </section>
      ))}
      <section id="help" className="docs-help">
        <h2>Building something? We’re here to help.</h2>
        <p>Have a question about the beta or your workspace?</p>
        <a className="docs-inline-link" href="mailto:admins@trycodev.com">
          Contact the CoDev team →
        </a>
      </section>
    </div>
  );
}
