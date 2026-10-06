# Billing

Owns Stripe checkout, customer portal, subscription synchronization and workspace entitlements.
Account deletion uses `delete-customer.ts` to expire pending checkouts and cancel
subscriptions by deleting the Stripe customer. Auth owns the surrounding account
erasure transaction; billing does not delete workspace or profile data.

See `docs/BILLING.md` for configuration and `docs/LEGAL.md` for policy publication
and verified deletion requirements.

`workspace-entitlement.ts` resolves paid/admin access and gated free ARM allowances
from current owned workspace count. Gen 2 owns the retained usage ledger, active
reservations, lifecycle enforcement, and budget snapshots; billing owns policy
constants and subscription eligibility. Collaborators consume the owner's policy.
