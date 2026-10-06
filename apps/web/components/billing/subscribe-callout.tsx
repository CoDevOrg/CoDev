import Link from "next/link";
import { Check, Lock } from "lucide-react";

import { BillingButton } from "@/components/billing/billing-button";
import { INDIVIDUAL_FEATURES } from "@/components/billing/plan";
import { Card } from "@/components/ui/card";

/** Shown where a workspace would be created when the member has no plan. */
export function SubscribeCallout({
  pastDue = false,
}: {
  priceUsdPerMonth?: number;
  pastDue?: boolean;
}) {
  if (pastDue) {
    return (
      <Card className="flex flex-col gap-5 px-7 py-7 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold tracking-tight">
            Your payment needs attention
          </h2>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            Your last payment didn&apos;t go through, so workspaces are paused.
            Update your payment method to continue.
          </p>
        </div>
        <BillingButton action="portal" size="lg" variant="solid">
          Update payment method
        </BillingButton>
      </Card>
    );
  }

  return (
    <Card className="grid gap-8 overflow-hidden bg-gradient-to-br from-primary/[0.07] via-card to-card px-7 py-8 md:grid-cols-[1fr_auto] md:items-center md:gap-12 md:px-9">
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold tracking-[0.12em] text-primary uppercase">
            Hosted workspace plans
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">
            Subscribe to create workspaces
          </h2>
          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
            Choose the workspace hours and concurrency you need. Teammates you
            invite join at no cost.
          </p>
        </div>
        <ul className="space-y-2 text-sm">
          {INDIVIDUAL_FEATURES.map((line) => (
            <li className="flex items-start gap-2.5" key={line}>
              <Check
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-primary"
              />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-4 md:w-60 md:items-stretch">
        <p className="flex items-baseline gap-1.5">
          <span className="text-5xl font-semibold tracking-tight tabular-nums">
            $20
          </span>
          <span className="text-sm text-muted-foreground">/ month</span>
        </p>
        <Link
          className="inline-flex h-11 items-center justify-center rounded-full bg-foreground px-6 text-[15px] font-semibold text-background transition-opacity hover:opacity-90"
          href="/pricing"
        >
          Compare plans
        </Link>
        <div className="space-y-1.5 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <Lock aria-hidden className="size-3" />
            Secure checkout by Stripe. Cancel anytime.
          </p>
          <Link
            className="inline-block underline-offset-4 hover:text-foreground hover:underline"
            href="/pricing"
          >
            See plan details
          </Link>
        </div>
      </div>
    </Card>
  );
}
