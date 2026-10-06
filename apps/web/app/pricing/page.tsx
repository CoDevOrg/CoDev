import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

import "@/app/product-theme.css";

import { PricingPlanCard } from "@/components/billing/pricing-plan-card";
import { getCurrentAppUser } from "@/lib/auth/identity";
import { getBillingStatus } from "@/lib/billing/access";
import {
  ENTERPRISE_PLAN,
  FREE_PLAN,
  SELF_SERVE_PLANS,
} from "@/lib/billing/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Cloud development workspaces from $20/month. Bring your own AI provider and invite collaborators for free.",
};

const FAQ = [
  {
    question: "What counts as workspace time?",
    answer:
      "Time counts while an Azure workspace VM is allocated, including startup. Idle workspaces stop automatically after 15 minutes and your persistent files remain saved.",
  },
  {
    question: "Are AI model charges included?",
    answer:
      "No. You connect your own supported AI provider account, so model usage is billed directly by that provider. CoDev pricing covers the hosted workspace, collaboration, and control plane.",
  },
  {
    question: "Do collaborators need a paid seat?",
    answer:
      "No. People you invite can join and collaborate at no extra charge. Compute and workspace limits belong to the workspace owner's plan.",
  },
  {
    question: "Can I change or cancel my plan?",
    answer:
      "Yes. Stripe's customer portal lets you change plans, update payment details, view invoices, or cancel. Cancellation takes effect at the end of the paid period.",
  },
  {
    question: "What happens when I reach my hours?",
    answer:
      "Compute pauses until the next monthly reset. Your workspace files stay on persistent storage, and you can change plans from Billing if you need more time sooner.",
  },
] as const;

export default async function PricingPage() {
  const user = await getCurrentAppUser();
  const billing = user ? await getBillingStatus(user.id) : null;
  const currentPlanId = billing?.hasAccess ? billing.planId : "free";
  const plans = [FREE_PLAN, ...SELF_SERVE_PLANS];

  return (
    <div className="product-scope min-h-dvh">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <Link
          aria-label="CoDev home"
          className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight"
          href="/"
        >
          <Image
            alt=""
            height={26}
            priority
            src="/brand/codev-mark.svg"
            width={26}
          />
          CoDev
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1 text-sm">
          <Link
            className="rounded-full px-3 py-1.5 font-medium"
            href="/pricing"
          >
            Pricing
          </Link>
          <Link
            className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
            href={user ? "/gen2" : "/sign-in?callbackUrl=/pricing"}
          >
            {user ? "Open CoDev" : "Sign in"}
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-6 pt-12 pb-24 sm:pt-20">
        <section className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">
            Pricing
          </p>
          <h1 className="mt-4 text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-6xl">
            Pay for workspace time, not seats.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
            Every plan includes persistent ARM64 workspaces and free
            collaborators. Connect your own AI provider account and keep model
            billing under your control.
          </p>
        </section>

        <section
          aria-label="Plans"
          className="mt-14 grid gap-5 md:grid-cols-2 xl:grid-cols-4"
        >
          {plans.map((plan) => (
            <PricingPlanCard
              current={currentPlanId === plan.id}
              featured={plan.id === "power"}
              hasPaidPlan={
                billing?.hasAccess === true || billing?.status === "past_due"
              }
              key={plan.id}
              plan={plan}
              signedIn={Boolean(user)}
            />
          ))}
        </section>

        <section className="mt-8">
          <PricingPlanCard
            current={currentPlanId === "enterprise"}
            hasPaidPlan={
              billing?.hasAccess === true || billing?.status === "past_due"
            }
            plan={ENTERPRISE_PLAN}
            signedIn={Boolean(user)}
          />
        </section>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Monthly hours are shared across the workspaces on your plan. AI usage
          is billed separately by your connected provider.
        </p>

        <section
          aria-labelledby="faq-heading"
          className="mx-auto mt-24 max-w-2xl"
        >
          <h2
            className="mb-6 text-center text-2xl font-semibold tracking-tight"
            id="faq-heading"
          >
            Questions
          </h2>
          <div className="divide-y divide-border/70 border-y border-border/70">
            {FAQ.map((item) => (
              <details className="group py-1" key={item.question}>
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 rounded-md py-3 text-[15px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <ChevronDown
                    aria-hidden
                    className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                    data-icon="inline-end"
                  />
                </summary>
                <p className="pr-8 pb-4 text-sm leading-relaxed text-muted-foreground">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60 px-6 py-8">
        <nav
          aria-label="Footer"
          className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground"
        >
          <Link className="hover:text-foreground" href="/">
            Home
          </Link>
          <Link className="hover:text-foreground" href="/legal/privacy">
            Privacy
          </Link>
          <Link className="hover:text-foreground" href="/legal/terms">
            Terms
          </Link>
          <Link className="hover:text-foreground" href="/legal/refunds">
            Refunds & cancellation
          </Link>
          <Link className="hover:text-foreground" href="/legal/retention">
            Data retention
          </Link>
        </nav>
      </footer>
    </div>
  );
}
