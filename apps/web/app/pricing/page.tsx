import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Check, ChevronDown, Lock } from "lucide-react";

import "@/app/product-theme.css";

import { BillingButton } from "@/components/billing/billing-button";
import { INDIVIDUAL_FEATURES } from "@/components/billing/plan";
import { LinkButton } from "@/components/ui/button";
import { getCurrentAppUser } from "@/lib/auth/identity";
import { getBillingStatus } from "@/lib/billing/access";
import {
  INDIVIDUAL_PLAN_NAME,
  INDIVIDUAL_PRICE_USD_PER_MONTH,
} from "@/lib/billing/config";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "One plan, everything included: cloud workspaces with built-in AI agents. Teammates you invite join at no cost.",
};

const COLLABORATOR_FEATURES = [
  "Join any workspace you are invited to",
  "Work in the same terminals and with the same agents",
  "Nothing to pay, no card required",
] as const;

const FAQ = [
  {
    question: "Who pays for a workspace?",
    answer:
      "Only the person who owns it. Teammates you invite join your workspace at no cost, and they never need a plan of their own to take part.",
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes. Manage billing opens Stripe's customer portal, where you can cancel in a click. Your plan stays active until the end of the period you have already paid for.",
  },
  {
    question: "How do I pay?",
    answer:
      "Checkout and billing are handled by Stripe. Your card details go straight to Stripe and never touch CoDev's servers.",
  },
  {
    question: "What happens if a payment fails?",
    answer:
      "Creating workspaces and running agents pause until you update your payment method. Your settings and billing page stay open so you can fix it.",
  },
] as const;

export default async function PricingPage() {
  const user = await getCurrentAppUser();
  const billing = user ? await getBillingStatus(user.id) : null;
  const owned = billing?.hasAccess === true && billing.accessSource !== "admin";

  return (
    <div className="product-scope min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link
          aria-label="CoDev home"
          className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight"
          href="/"
        >
          <Image
            alt=""
            height={26}
            priority
            src="/brand/codev-mark-v3.png"
            width={26}
          />
          CoDev
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1 text-sm">
          <Link
            aria-current="page"
            className="rounded-full px-3 py-1.5 font-medium text-foreground"
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

      <main className="mx-auto max-w-5xl px-6 pt-12 pb-24 sm:pt-20">
        <section className="mx-auto max-w-2xl space-y-4 text-center">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">
            Pricing
          </p>
          <h1 className="text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-6xl">
            One plan. Everything included.
          </h1>
          <p className="text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
            A cloud workspace with an AI agent built in. You pay once for the
            workspace; everyone you invite works in it for free.
          </p>
        </section>

        <section
          aria-label="Plans"
          className="mx-auto mt-14 grid max-w-3xl gap-5 md:grid-cols-[1.15fr_1fr] md:items-stretch"
        >
          <article className="relative flex flex-col gap-7 rounded-3xl border border-primary/30 bg-gradient-to-b from-primary/[0.09] via-card to-card p-8 shadow-[0_30px_80px_-40px] shadow-primary/50">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">
                {INDIVIDUAL_PLAN_NAME}
              </h2>
              {owned ? (
                <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary">
                  Your plan
                </span>
              ) : null}
            </div>

            <p className="flex items-baseline gap-2">
              <span className="text-6xl font-semibold tracking-tight tabular-nums">
                ${INDIVIDUAL_PRICE_USD_PER_MONTH}
              </span>
              <span className="text-sm text-muted-foreground">
                per month, billed monthly
              </span>
            </p>

            {!user ? (
              <LinkButton
                className="w-full"
                href="/sign-in?callbackUrl=/pricing"
                size="lg"
                variant="solid"
              >
                Get started
              </LinkButton>
            ) : owned ? (
              <LinkButton
                className="w-full"
                href="/settings/personal/billing"
                size="lg"
                variant="outline"
              >
                Manage plan
              </LinkButton>
            ) : (
              <BillingButton
                action="checkout"
                fullWidth
                size="lg"
                variant="solid"
              >
                Subscribe for ${INDIVIDUAL_PRICE_USD_PER_MONTH}/month
              </BillingButton>
            )}

            <ul className="space-y-3 border-t border-border/60 pt-6 text-sm">
              {INDIVIDUAL_FEATURES.map((line) => (
                <li className="flex items-start gap-3" key={line}>
                  <Check
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-primary"
                  />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock aria-hidden className="size-3" />
              Secure checkout by Stripe. Cancel anytime.
            </p>
          </article>

          <article className="flex flex-col gap-7 rounded-3xl border border-border bg-card/60 p-8">
            <h2 className="text-lg font-semibold tracking-tight">
              Collaborator
            </h2>
            <p className="flex items-baseline gap-2">
              <span className="text-6xl font-semibold tracking-tight tabular-nums">
                $0
              </span>
              <span className="text-sm text-muted-foreground">
                when you are invited
              </span>
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Ask the workspace owner for an invite link. No plan needed.
            </p>
            <ul className="space-y-3 border-t border-border/60 pt-6 text-sm">
              {COLLABORATOR_FEATURES.map((line) => (
                <li className="flex items-start gap-3" key={line}>
                  <Check
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </article>
        </section>

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
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
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
          className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground"
        >
          <Link className="hover:text-foreground" href="/">
            Home
          </Link>
          <Link className="hover:text-foreground" href="/legal/privacy">
            Privacy
          </Link>
          <Link className="hover:text-foreground" href="/legal/retention">
            Data retention
          </Link>
        </nav>
      </footer>
    </div>
  );
}
