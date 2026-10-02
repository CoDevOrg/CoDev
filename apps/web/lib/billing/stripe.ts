import "server-only";

import Stripe from "stripe";

import { requireBillingEnv } from "./config";

const state = globalThis as typeof globalThis & { __codevStripe?: Stripe };

/** Lazy so a build or a route that never bills does not need the key. */
export function getStripe(): Stripe {
  if (!state.__codevStripe) {
    state.__codevStripe = new Stripe(requireBillingEnv("STRIPE_SECRET_KEY"), {
      maxNetworkRetries: 2,
      appInfo: { name: "CoDev" },
    });
  }
  return state.__codevStripe;
}
