import Link from "next/link";
import { Check } from "lucide-react";
import type { SelfServePlanId } from "@codev/contracts";

import { BillingButton } from "@/components/billing/billing-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { BillingPlan } from "@/lib/billing/plans";
import { cn } from "@/lib/platform/utils";

export function PricingPlanCard({
  plan,
  signedIn,
  current,
  hasPaidPlan,
  featured = false,
}: {
  plan: BillingPlan;
  signedIn: boolean;
  current: boolean;
  hasPaidPlan: boolean;
  featured?: boolean;
}) {
  const selfServe = ["pro", "power", "team"].includes(plan.id);

  return (
    <Card
      className={cn(
        "flex min-h-[29rem] flex-col gap-0 overflow-hidden",
        featured && "border-primary/60 shadow-lg shadow-primary/10",
      )}
    >
      <CardHeader className="gap-3 p-6 pb-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-xl">{plan.name}</CardTitle>
          {current ? <Badge>Current plan</Badge> : null}
          {featured && !current ? (
            <Badge variant="muted">Most popular</Badge>
          ) : null}
        </div>
        <CardDescription className="min-h-10 leading-relaxed">
          {plan.description}
        </CardDescription>
        <p className="flex items-baseline gap-1.5 pt-2">
          <span className="text-4xl font-semibold tracking-tight tabular-nums">
            ${plan.priceUsdPerMonth}
          </span>
          <span className="text-sm text-muted-foreground">
            {plan.priceUsdPerMonth === 0 ? "forever" : "/ month"}
          </span>
        </p>
      </CardHeader>

      <CardContent className="flex-1 border-t border-border/60 px-6 py-5">
        <ul className="grid gap-3 text-sm">
          {plan.features.map((feature) => (
            <li className="flex items-start gap-2.5" key={feature}>
              <Check
                aria-hidden
                className="mt-0.5 text-primary"
                data-icon="inline-start"
              />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </CardContent>

      <CardFooter className="border-t border-border/60 p-6">
        {!signedIn ? (
          <Link
            className="inline-flex h-11 w-full items-center justify-center rounded-full bg-foreground px-6 text-[15px] font-semibold text-background transition-opacity hover:opacity-90"
            href="/sign-in?callbackUrl=/pricing"
          >
            {plan.id === "free" ? "Start free" : "Get started"}
          </Link>
        ) : current || hasPaidPlan ? (
          <Link
            className="inline-flex h-11 w-full items-center justify-center rounded-full border border-border px-6 text-[15px] font-semibold transition-colors hover:bg-accent"
            href={plan.id === "free" ? "/gen2" : "/settings/personal/billing"}
          >
            {current
              ? plan.id === "free"
                ? "Open CoDev"
                : "Manage plan"
              : "Change plan"}
          </Link>
        ) : selfServe ? (
          <BillingButton
            action="checkout"
            className="w-full"
            fullWidth
            planId={plan.id as SelfServePlanId}
            size="lg"
            variant="solid"
          >
            Choose {plan.name}
          </BillingButton>
        ) : (
          <Link
            className="inline-flex h-11 w-full items-center justify-center rounded-full border border-border px-6 text-[15px] font-semibold transition-colors hover:bg-accent"
            href="mailto:sales@trycodev.com?subject=CoDev%20Enterprise"
          >
            Contact sales
          </Link>
        )}
      </CardFooter>
    </Card>
  );
}
