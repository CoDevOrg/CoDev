import { getBillingPlan } from "@/lib/billing/plans";

/** Kept for compact upgrade callouts that specifically promote Individual. */
export const INDIVIDUAL_FEATURES = getBillingPlan("pro").features;
