# Billing

Owns Stripe checkout, customer portal, subscription synchronization and paid access.
Account deletion uses `delete-customer.ts` to expire pending checkouts and cancel
subscriptions by deleting the Stripe customer. Auth owns the surrounding account
erasure transaction; billing does not delete workspace or profile data.

See `docs/BILLING.md` for configuration and `docs/LEGAL.md` for policy publication
and verified deletion requirements.
