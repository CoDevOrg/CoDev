import type { PlanId, SelfServePlanId } from "@codev/contracts";

export type BillingPlan = {
  id: PlanId;
  name: string;
  priceUsdPerMonth: number;
  monthlyComputeHours: number | null;
  workspaceLimit: number;
  activeWorkspaceLimit: number;
  description: string;
  features: readonly string[];
};

export type SelfServeBillingPlan = BillingPlan & { id: SelfServePlanId };

export const FREE_PLAN: BillingPlan = {
  id: "free",
  name: "Free",
  priceUsdPerMonth: 0,
  monthlyComputeHours: null,
  workspaceLimit: 1,
  activeWorkspaceLimit: 1,
  description: "Try a real cloud workspace before you subscribe.",
  features: [
    "5 lifetime workspace hours",
    "1 persistent ARM64 workspace",
    "1 active workspace at a time",
    "Bring your own AI provider account",
  ],
};

export const SELF_SERVE_PLANS: readonly SelfServeBillingPlan[] = [
  {
    id: "pro",
    name: "Individual",
    priceUsdPerMonth: 20,
    monthlyComputeHours: 40,
    workspaceLimit: 1,
    activeWorkspaceLimit: 1,
    description: "For focused individual work.",
    features: [
      "40 shared workspace hours each month",
      "1 persistent ARM64 workspace",
      "1 active workspace at a time",
      "Unlimited free collaborators",
    ],
  },
  {
    id: "power",
    name: "Power",
    priceUsdPerMonth: 50,
    monthlyComputeHours: 120,
    workspaceLimit: 2,
    activeWorkspaceLimit: 2,
    description: "For daily work across multiple projects.",
    features: [
      "120 shared workspace hours each month",
      "2 persistent ARM64 workspaces",
      "2 active workspaces at a time",
      "Unlimited free collaborators",
    ],
  },
  {
    id: "team",
    name: "Team",
    priceUsdPerMonth: 99,
    monthlyComputeHours: 200,
    workspaceLimit: 5,
    activeWorkspaceLimit: 3,
    description: "A shared pool for a small team.",
    features: [
      "200 shared workspace hours each month",
      "5 persistent ARM64 workspaces",
      "3 active workspaces at a time",
      "Unlimited team members and collaborators",
    ],
  },
] as const;

export const ENTERPRISE_PLAN: BillingPlan = {
  id: "enterprise",
  name: "Enterprise",
  priceUsdPerMonth: 499,
  monthlyComputeHours: 1_000,
  workspaceLimit: 20,
  activeWorkspaceLimit: 10,
  description: "Higher limits, onboarding, and support for larger teams.",
  features: [
    "From 1,000 shared workspace hours each month",
    "From 20 persistent ARM64 workspaces",
    "From 10 active workspaces at a time",
    "Custom limits, onboarding, and support",
  ],
};

export const BILLING_PLANS = [
  FREE_PLAN,
  ...SELF_SERVE_PLANS,
  ENTERPRISE_PLAN,
] as const;

export function getBillingPlan(planId: PlanId): BillingPlan {
  return BILLING_PLANS.find((plan) => plan.id === planId) ?? FREE_PLAN;
}

export function getSelfServePlan(planId: SelfServePlanId): BillingPlan {
  return SELF_SERVE_PLANS.find((plan) => plan.id === planId)!;
}

export function isPaidPlanId(
  planId: PlanId,
): planId is Exclude<PlanId, "free"> {
  return planId !== "free";
}
