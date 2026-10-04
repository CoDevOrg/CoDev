# Legal policies and account deletion

Status: publication authorized by the owner on October 4, 2026. Public policies
identify the service as **CoDev**, omit a business address as requested, and use
**admins@trycodev.com**. This is not a legal opinion or guarantee against claims.

## Ongoing operational and legal review

1. The owner directed publication using CoDev without an address. The draft
   banner and name/address environment gate have been removed. Applicable
   trader/contact disclosure requirements still need jurisdiction-specific review.
2. Have counsel review applicability based on the operator, customer locations,
   business/consumer use and actual practices. Review limitation language,
   consumer withdrawal rules, age restrictions, privacy notices, and any need
   for an EU/UK representative or DPA. No mandatory arbitration or class-action
   waiver has been inserted without a jurisdiction-specific review.
3. Confirm the voluntary refund approach. The policy reviews requests case by
   case and always preserves mandatory remedies. It makes no automatic refund
   promise and does not penalize or prohibit chargebacks.
4. Confirm access to admins@trycodev.com and test inbound/outbound support.
   The existing domain documentation records catch-all inbound forwarding;
   this change does not configure or verify a mailbox.
5. Record actual retention periods for Postgres backups, runtime snapshots,
   Vercel/Azure logs, Redis, emails, finance records and dispute evidence.
   Assign request handling and deletion follow-up to an operator, including
   provider erasure requests and deletion replay after a backup restore.
   The code does not implement a universal backup/log retention scheduler.
6. Verify the provider inventory, processing locations, signed DPAs/transfer
   safeguards and providers' actual training/retention settings. The code
   alone cannot verify these contractual settings. Check any infrastructure
   service not named in the repository against the published privacy notice.
7. Configure Stripe **live and sandbox** public business details with
   `https://trycodev.com/legal/terms`, `/legal/privacy`, `/legal/refunds` and
   the support address. Required `terms_of_service` consent in Checkout needs
   the account's terms URL. Confirm the customer portal allows cancellation
   at period end and invoice access; validate receipts, tax handling, billing
   descriptors and renewal notices for the regions served. The existing
   local keys are sandbox keys but the default database is shared.
8. Use throwaway accounts and sandbox payments to verify the complete hosted
   checkout and email-delivery flow before releasing. Stripe customer deletion
   needs Customers write permission, plus Checkout Sessions read/write to
   expire pending checkouts. Do not test deletion against real accounts.

## Pages and behavior

- `/legal/privacy`: account/content/credential/billing/telemetry data, providers,
  shared workspaces, rights, transfers, security and contact.
- `/legal/terms`: eligibility, content permissions, AI limitations, acceptable
  use, subscriptions, suspension, liability and preserved statutory rights.
- `/legal/refunds`: recurring charges, cancellation steps, refund requests,
  account deletion, external subscriptions and payment disputes.
- `/legal/retention`: active data, workspace deletion, account deletion and
  shared-history/finance/backup exceptions.
- `/legal/cookies`: essential browser storage and optional analytics.

New route directories are required by Next.js routing for the new policies
and `/api/settings/account`; other new code belongs to existing feature folders.

Public footers, sign-in, checkout controls and Profile link the policies.
Stripe Checkout collects required terms acceptance and stores policy versions
on the session. Its stored consent and transaction timestamps provide payment
acceptance evidence. Sign-in displays a continuing-use agreement notice;
this change does **not** add a versioned signup clickwrap receipt or force
existing users to reaccept. Counsel should decide whether a dedicated
acceptance/renewal flow is required before rollout.

Both analytics systems stay off before affirmative consent. Reject and allow
have equal prominence. Global Privacy Control and Do Not Track override an
allow preference. The server visit endpoint independently enforces consent.
Query strings/fragments are removed from event URLs and UUID path segments
are generalized. CoDev referrers retain only the origin. Essential hosting
logs are separate. Existing historical analytics rows are not retroactively
sanitized by this patch.

## Deletion flow

Settings → Profile exposes the existing limited account-details export and
an explicit AlertDialog. POST `/api/settings/account` sends a signed, purpose-
bound 15-minute verification code through Resend (three requests per 15 minutes).
DELETE requires the same-origin browser session, the code bound to its user ID
and current email, and the literal confirmation `DELETE`. A GET never deletes.
No verification code is logged or placed in a URL.

Deletion locks the user row and checks prerequisites before external changes:
owned Gen 2/legacy workspaces, organization responsibilities, running agents,
credential use and active hosted connection attempts must be resolved first.
This avoids orphaned disks and unexpected destruction of other owners' work.
Legacy-workspace cleanup needs operator help because its UI was removed.

Open Stripe checkouts are expired and the customer is deleted, immediately
canceling subscriptions and removing saved cards. A billing error prevents
account erasure. A database failure after Stripe succeeds can leave a canceled
subscription with an intact account: the user sees a retryable failure, and
retry accepts Stripe's already-deleted customer. Wrong-mode/missing Stripe
customers fail closed. External AI subscriptions are never canceled here.

Within the database transaction, shared attribution is moved to an unlinked,
non-login “Deleted account” identity. Personal credential rows, linked visits
and waitlist information are erased explicitly; deleting the original user
cascades memberships, personal conversations (including shared chats they own),
GitHub tokens, environment variables, CLI/device/push tokens and other personal
rows. Billing IDs remain on a renamed personal organization for finance and
disputes. Shared text/Git history can still contain personal information and
needs case-specific erasure review; the UI and policy explain this limitation.

Auth.js verifies the original user still exists on each JWT refresh/request;
a previously issued session no longer grants access after deletion. Late
Stripe events for a deleted user are ignored. Requests already in flight and
copies exported to third parties need operational review; do not describe
this as instantaneous erasure of all copies everywhere.

## Verification

Unit tests cover signed-code binding/expiry, cross-origin and anonymous
requests, explicit confirmation, caller identity, failure responses, Stripe
retry behavior, consent enforcement, URL sanitization and late webhooks.

The PostgreSQL integration suite is opt-in and accepts only the isolated URL
`postgresql://codev_test@127.0.0.1:55439/codev_deletion_test`. Provision a disposable
local PostgreSQL database with the current Drizzle schema, then run:

```sh
CODEV_DELETION_TEST_DATABASE_URL=postgresql://codev_test@127.0.0.1:55439/codev_deletion_test \
  pnpm --filter @codev/web exec vitest run lib/auth/account-deletion.integration.test.ts
```

It truncates fixture tables. Never point it at shared development or production.
It tests real foreign-key cascades and transactions; Stripe is mocked.

## Validation results (October 4, 2026)

- Web, contracts and database TypeScript checks pass. The web route types were
  regenerated because the old generated cache referenced removed routes.
- Changed web files pass ESLint with no warnings. `git diff --check` passes.
- 50 focused/existing regression tests, one deletion-dialog test, and four
  tests against disposable PostgreSQL passed (55 total).
- Browser: privacy page renders without an error overlay; the banner has
  equally visible allow/reject controls; no analytics request occurs before
  consent. Home and sign-in navigation and policy links were checked.
- Publication checkout: repository typechecks and formatting pass. Lint passes
  with seven existing warnings. Cloudflare production build passes.
- Terminal HTTP fallback tests now explicitly disable WebSocket so the tests
  do not depend on a real network connection from the test environment.
- Cloudflare email and billing secret availability still needs operational
  verification. Deletion fails safely with a support contact when email cannot
  be sent; no account is erased without verification and billing cleanup.
- Live Stripe checkout/customer deletion and Resend delivery were not exercised.
  Stripe deletion was mocked around real database transactions. No production
  accounts, payments, workspaces or database rows were changed.

## References consulted (October 2, 2026)

These informed original drafts; no claim is made that Termly generated or
reviewed these documents.

- [Termly privacy generator](https://termly.io/products/privacy-policy-generator/): policies must match actual collection and processing.
- [OPC Canada — meaningful consent](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/p_principle/principles/p_consent/): consent and transparency.
- [California DOJ — CCPA](https://oag.ca.gov/privacy/ccpa): applicability thresholds, access/deletion/correction, sale/sharing opt-out and non-discrimination.
- [ICO — erasure](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/): scope, exceptions and backups.
- [European Commission — Consumer Rights Directive](https://commission.europa.eu/law/law-topic/consumer-protection-law/consumer-contract-law/consumer-rights-directive_en): pre-contract information and withdrawal rights.
- [FTC — subscriptions and cancellation](https://consumer.ftc.gov/articles/getting-and-out-free-trials-auto-renewals-and-negative-option-subscriptions): clear renewal/cancellation information and dispute rights. Do not rely on the vacated 2024 Click-to-Cancel rule as current law.
- [Stripe — payment disputes](https://stripe.com/guides/introduction-to-payment-disputes): evidence and clear purchase/cancellation/refund information.
- [Stripe — delete customer](https://docs.stripe.com/api/customers/delete): subscription cancellation, card removal and retrievable transaction history.
