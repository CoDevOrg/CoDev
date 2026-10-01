# Billing (Stripe)

The **Individual** plan is $20/month, sold through Stripe Checkout. It is the
existing `pro` plan (`plans.name = 'Individual'`); the billing entity is the
member's personal organization (`organizations.id == users.id`), whose
`organization_subscriptions` row holds the Stripe ids.

## Paywall

- Creating a Gen 2 workspace and starting its compute need the plan.
  `requireIndividualPlan(userId)` and `requireWorkspaceOwnerPlan(workspaceId)`
  in `apps/web/lib/billing/` throw `BillingRequiredError` (HTTP 402,
  `code: "subscription_required"`).
- **The workspace owner pays.** Collaborators need no plan. A lapsed owner
  blocks machine start, terminals and agent turns for everyone; reads stay open.
- Access = `plan_id = pro` and `status in (active, trialing)`. A Stripe row also
  has to be inside its paid period plus 3 days, so a lost webhook cannot keep
  access open. `past_due` and `canceled` are blocked.
- Application admins are exempt. An admin can comp a plan from the admin
  console; that cannot overwrite a live Stripe subscription.
- Guarded: `createGen2Workspace`, `ensureGen2Instance`, `startGen2Terminal`,
  `sendGen2TerminalInput`, `startGen2AgentTurn`, and the Superset agent
  session/input/turn starts. Add the guard to any new entry that starts compute.

## Pages

`/pricing` is public (plan, FAQ, and a Subscribe / Manage plan button that
depends on sign-in and plan). The paywall callout on `/gen2` and the settings
Billing page share the same plan copy (`components/billing/plan.ts`).

Local `.env.local` uses Stripe **sandbox** keys. It points at the shared
Postgres, so a sandbox checkout there writes a real subscription row; use a
throwaway account when testing. A stored customer id from the other Stripe
mode is replaced automatically on the next checkout.

## Flow

1. `POST /api/billing/checkout` creates (once) a Stripe customer, remembers it
   on the subscription row, and returns a Checkout Session URL.
2. The member pays on Stripe. On return, `/settings/personal/billing` syncs the
   finished session immediately; the webhook is the durable path.
3. `POST /api/billing/webhook` verifies the signature, re-fetches the
   subscription from Stripe (never trusts the payload), and upserts the row.
   Handled events: `checkout.session.completed`,
   `customer.subscription.created|updated|deleted`, `invoice.paid`,
   `invoice.payment_failed`. Processed event ids are stored in
   `stripe_webhook_events`; a failure returns 500 so Stripe retries.
4. `POST /api/billing/portal` opens the Stripe Customer Portal (card, invoices,
   cancel). Cancelling keeps access until the period ends.

## Environment (server only)

| Variable                         | Purpose                                             |
| -------------------------------- | --------------------------------------------------- |
| `STRIPE_SECRET_KEY`              | Stripe API key (`sk_...` or a restricted `rk_...`)  |
| `STRIPE_WEBHOOK_SECRET`          | `whsec_...` of the webhook endpoint                 |
| `STRIPE_PRICE_ID_INDIVIDUAL`     | `price_...` of the $20/month recurring price        |
| `STRIPE_PORTAL_CONFIGURATION_ID` | Optional `bpc_...`; omit to use the account default |

Vercel **Production** uses live keys; **Preview** and local use a Stripe sandbox.
A restricted key needs write access to Customers, Checkout Sessions, Customer
portal and Subscriptions (read is enough for Subscriptions).

## Provisioning

```bash
# product + recurring price (add --live for the live account)
stripe products create --name "CoDev Individual"
stripe prices create --product prod_... --currency usd --unit-amount 2000 \
  -d "recurring[interval]=month" --lookup-key codev_individual_monthly
# webhook (pin the API version to the SDK's)
stripe webhook_endpoints create --url https://www.trycodev.com/api/billing/webhook \
  --api-version 2026-08-26.dahlia \
  -d "enabled_events[]=checkout.session.completed" \
  -d "enabled_events[]=customer.subscription.created" \
  -d "enabled_events[]=customer.subscription.updated" \
  -d "enabled_events[]=customer.subscription.deleted" \
  -d "enabled_events[]=invoice.paid" \
  -d "enabled_events[]=invoice.payment_failed"
# local development
stripe listen --forward-to localhost:3000/api/billing/webhook
```

Apply migration `0064_stripe_billing` to the database before deploying.

## Troubleshooting

- Member paid but is blocked: check their `organization_subscriptions` row
  (`provider = 'stripe'`, `status`, `current_period_end`), then the webhook
  delivery log in Stripe. Re-sending the event repairs the row.
- Webhooks 400: wrong `STRIPE_WEBHOOK_SECRET` for the mode (live vs sandbox).
- Refunds, tax and invoices are handled in the Stripe Dashboard.
