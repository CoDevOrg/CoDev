# Billing (Stripe)

CoDev bills for hosted ARM64 workspace capacity, not collaborator seats or AI
model usage. Members connect their own AI provider account. The workspace owner
pays; invited collaborators are free and consume the owner's shared allowance.

## Plans

| Plan               |    Stripe price |         Workspace time | Persistent workspaces | Active at once |
| ------------------ | --------------: | ---------------------: | --------------------: | -------------: |
| Free               |              $0 |       5 lifetime hours |                     1 |              1 |
| Individual (`pro`) |       $20/month |         40 hours/month |                     1 |              1 |
| Power              |       $50/month |        120 hours/month |                     2 |              2 |
| Team               |       $99/month |        200 hours/month |                     5 |              3 |
| Enterprise         | From $499/month | From 1,000 hours/month |               From 20 |        From 10 |

Individual, Power, and Team are self-serve monthly subscriptions. Enterprise is
sales-assisted and is not exposed as a self-serve Stripe price. Monthly hours
are pooled across an owner's workspaces. Idle workspaces stop after 15 minutes;
persistent disks remain attached across stops.

`apps/web/lib/billing/plans.ts` is the product catalog used by pricing, Billing,
and runtime entitlements. Keep Stripe product metadata and this catalog aligned.

## Paywall and limits

- `requireIndividualPlan(userId)` retains its historical name but accepts any
  active paid plan. `requireWorkspaceOwnerPlan(workspaceId)` gates compute for
  the workspace owner.
- Access requires a non-Free plan in `active` or `trialing`. Stripe rows must be
  inside their paid period plus the three-day webhook grace. `past_due` and
  `canceled` are blocked.
- Application admins are exempt. Provider-less paid rows are admin grants.
- Free usage is cumulative across the account's lifetime and does not reset.
  Paid usage resets at the start of each UTC month.
- Durable compute claims enforce plan concurrency before an Azure start is
  queued. Workspace creation enforces the plan's persistent-workspace limit.
- The free monthly US$6.50 Azure budget guard remains a safety breaker in
  addition to the five-hour lifetime allowance.

Additional usage is intentionally not sold yet. Do not advertise top-ups or
automatic overages until metered usage reporting and customer opt-in exist.

## Checkout and synchronization

1. `POST /api/billing/checkout` validates `{ planId: "pro" | "power" | "team" }`,
   creates or reuses the member's Stripe customer, and starts Checkout.
2. Checkout stamps `userId` and `planId` on the subscription. The return page
   syncs immediately; webhooks remain the durable path.
3. Subscription sync maps a configured Stripe price ID to a CoDev plan. An
   unknown price never grants access.
4. `POST /api/billing/portal` opens the configured Customer Portal. The portal
   allows prorated switching among Individual, Power, and Team, plus payment
   updates, invoices, and cancellation.

Handled webhook events are `checkout.session.completed`,
`customer.subscription.created|updated|deleted`, `invoice.paid`, and
`invoice.payment_failed`. Processed event IDs are stored in
`stripe_webhook_events`.

## Environment (server only)

| Variable                         | Purpose                                          |
| -------------------------------- | ------------------------------------------------ |
| `STRIPE_SECRET_KEY`              | Stripe API key for the current mode              |
| `STRIPE_WEBHOOK_SECRET`          | Signing secret for the webhook endpoint          |
| `STRIPE_PRICE_ID_INDIVIDUAL`     | $20 monthly recurring price                      |
| `STRIPE_PRICE_ID_POWER`          | $50 monthly recurring price                      |
| `STRIPE_PRICE_ID_TEAM`           | $99 monthly recurring price                      |
| `STRIPE_PORTAL_CONFIGURATION_ID` | Portal configuration with plan switching enabled |

Local and Preview use the Stripe sandbox. Production must use the matching live
price and portal IDs; never mix IDs across modes.

## Provisioned Stripe objects

Lookup keys are stable across modes:

- `codev_individual_monthly`
- `codev_power_monthly`
- `codev_team_monthly`

The Stripe products carry `plan_id`, `monthly_hours`, `workspace_limit`, and
`active_workspace_limit` metadata for operator visibility. Runtime enforcement
uses the checked-in catalog, not mutable Stripe metadata.

## Database rollout

Run `pnpm db:migrate` immediately before deploying the matching application
build. Migrations `0072_add_power_plan_enum` and `0073_expand_compute_claims`
add the `power` enum value and change compute claims to a composite key so paid
tiers can reserve concurrent workspaces. The migration command seeds the Power
plan after PostgreSQL commits the new enum value. Do not apply `0073` while old
application instances still use owner-only claim conflicts.

## Troubleshooting

- Paid member is blocked: compare the subscription item price to the matching
  environment variable, then inspect `organization_subscriptions` and Stripe
  webhook deliveries.
- Portal lacks plan choices: verify the configured portal belongs to the same
  Stripe mode and has subscription updates enabled for all three products.
- Webhooks return 400: the signing secret belongs to a different endpoint or
  mode.
- Checkout returns 503: the selected tier's price environment variable is
  missing.

Checkout requires terms consent and attaches policy version metadata. Refunds,
tax, invoices, and cancellation are handled through Stripe; see [LEGAL.md](./LEGAL.md).
