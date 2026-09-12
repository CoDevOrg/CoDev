---
status: diagnosed
trigger: "The CoDev /admin page displays $0.00 spend/cost for all workspaces. Determine the confirmed root cause using code, local database diagnostics where safely available, and read-only AWS CLI / Cost Explorer calls."
created: 2026-09-05T16:17:04Z
updated: 2026-09-05T16:19:23Z
---

## Current Focus

hypothesis: confirmed — the activation-day early return suppresses a valid Cost Explorer current-day window and injects ec2Usd=0 into every runtime-weighted workspace allocation
test: completed; code-path computation and independent Cost Explorer results agree
expecting: satisfied — guard=true while tagged EC2 spend is non-zero and would format visibly
next_action: diagnosis returned; no code, AWS, database, or configuration mutation authorized

## Symptoms

expected: Admin workspace cost allocation should show non-zero real AWS EC2 spend when tagged CoDev infrastructure has incurred cost and runtime is recorded.
actual: Spend for all workspaces is displayed as $0.00.
errors: No visible error was reported.
reproduction: Open the /admin page and inspect the Workspaces section/cost columns.
started: Unknown whether it ever worked.

## Eliminated

- hypothesis: The UI rounds a small but non-zero workspace allocation down to $0.00.
  evidence: The formatter shows up to four decimal places, and the currently tagged EC2 total formats as $0.227; the injected zero alone formats as $0.00.
  timestamp: 2026-09-05T16:19:23Z

- hypothesis: Project=CoDev tags are missing from AWS resources or have no current-day Cost Explorer data.
  evidence: Read-only AWS queries found seven tagged EC2 resources and $0.2750953323 of tagged current-day spend.
  timestamp: 2026-09-05T16:19:23Z

- hypothesis: Cost Explorer returns EC2 under service names the application does not recognize.
  evidence: The live group keys are exactly Amazon Elastic Compute Cloud - Compute and EC2 - Other, both present in EC2_SERVICE_NAMES.
  timestamp: 2026-09-05T16:19:23Z

- hypothesis: Missing runtime records alone cause the displayed $0.00 values.
  evidence: When totalTrackedMinutes is zero, admin-workspaces returns null and the UI renders an em dash, not $0.00. The reported $0.00 workspace values therefore follow the positive-runtime allocation branch with spend.ec2Usd equal to zero.
  timestamp: 2026-09-05T16:19:23Z

## Evidence

- timestamp: 2026-09-05T16:17:30Z
  checked: prior GSD debug knowledge base
  found: .planning/debug/knowledge-base.md does not exist
  implication: there is no known-pattern candidate to prioritize

- timestamp: 2026-09-05T16:17:30Z
  checked: admin page spend rendering references
  found: apps/web/app/admin/page.tsx renders workspace.estimatedCostUsd and aggregate costTracking values supplied by apps/web/lib/admin-workspaces.ts
  implication: the report builder is the first server-side boundary to inspect; UI formatting alone cannot explain aggregate and per-workspace zero values without checking its inputs

- timestamp: 2026-09-05T16:18:00Z
  checked: complete apps/web/lib/admin-workspaces.ts allocation path
  found: each workspace cost is (trackedMinutes / totalTrackedMinutes) * spend.ec2Usd when runtime exists; aggregate values are copied directly from getRealCodevAwsSpend
  implication: with non-zero runtime, an ec2Usd input of zero deterministically renders $0.00 for every workspace

- timestamp: 2026-09-05T16:18:00Z
  checked: complete apps/web/lib/aws-cost.ts
  found: COST_TRACKING_START_DATE is 2026-09-05; endDate is today's UTC YYYY-MM-DD; when endDate <= start date, fetchCodevAwsSpend returns zero for totalUsd, ec2Usd, and overheadUsd before constructing or sending GetCostAndUsageCommand
  implication: on 2026-09-05 the application is guaranteed to report all-zero AWS spend regardless of recorded runtime or actual same-day resource activity

- timestamp: 2026-09-05T16:18:20Z
  checked: git history for the cost feature
  found: the feature was introduced in commit e3ce7f6a7 late on 2026-09-04 and hard-coded a 2026-09-05 cost-allocation-tag activation date from its first version
  implication: the symptom is consistent with first-day behavior and the feature may never yet have had a queryable non-empty tracking window

- timestamp: 2026-09-05T16:18:20Z
  checked: automated coverage for aws-cost and admin-workspaces
  found: no tests reference aws-cost.ts, admin-workspaces.ts, COST_TRACKING_START_DATE, or fetchCodevAwsSpend
  implication: the activation-day early-return behavior and allocation of a zero EC2 total are unprotected by regression tests

- timestamp: 2026-09-05T16:18:20Z
  checked: runtime interval persistence path
  found: apps/web/lib/vm-usage.ts inserts sandbox_runtime_intervals at sandbox start and closes them with real timestamps; admin-workspaces reads both closed intervals ending after the tracking start and all open intervals
  implication: runtime data is an independent allocation input and can be diagnosed without modifying records

- timestamp: 2026-09-05T16:18:40Z
  checked: first local aggregate database diagnostic attempt
  found: the attempt did not connect because @next/env is not directly resolvable from apps/web; no database query ran
  implication: no database evidence was obtained from that attempt; retry must use only installed dependencies and must continue to suppress connection details and row identifiers

- timestamp: 2026-09-05T16:19:00Z
  checked: second local aggregate database diagnostic attempt
  found: database configuration was available, but TLS verification failed with SELF_SIGNED_CERT_IN_CHAIN before the read-only SQL query executed
  implication: live runtime aggregates are not safely available from this environment without weakening certificate verification, so database contents remain unconfirmed and no records were read or changed

- timestamp: 2026-09-05T16:19:10Z
  checked: redacted AWS authentication and tagged resource inventory
  found: AWS CLI authentication succeeded without exposing identity; the configured region has seven Project=CoDev-tagged EC2 resources, including one stopped instance
  implication: the tag is present on real CoDev infrastructure; a missing resource tag is not the reason the application reports zero today

- timestamp: 2026-09-05T16:19:10Z
  checked: read-only Cost Explorer query for Project=CoDev during 2026-09-05 to 2026-09-06
  found: Cost Explorer accepted the current-day window and returned estimated tagged spend of $0.2750953323 total, with $0.2269512 for Amazon Elastic Compute Cloud - Compute, $0.0000066323 for EC2 - Other, and $0.0481375 for Amazon VPC
  implication: non-zero tagged spend exists now, and the application could retrieve it using a valid exclusive end date after the start date; its early return is suppressing real data

- timestamp: 2026-09-05T16:19:10Z
  checked: read-only Cost Explorer query for Project=CoDev before activation, 2026-09-01 to 2026-09-05
  found: the tag-filtered result was zero, while an account-level EC2-only query for the same period returned non-zero spend
  implication: tag activation timing explains why pre-September-5 spend cannot be attributed, but does not explain the current-day zero because tagged September-5 spend is already available

## Resolution

root_cause: apps/web/lib/aws-cost.ts sets both COST_TRACKING_START_DATE and today's UTC endDate to 2026-09-05, then treats endDate <= start as an empty period and returns hard-coded zeros before calling Cost Explorer. Cost Explorer requires an exclusive end date and already returns non-zero tagged spend for the valid 2026-09-05 to 2026-09-06 window. apps/web/lib/admin-workspaces.ts multiplies every positive runtime share by the injected ec2Usd=0, producing $0.00 for every workspace. The one-hour unstable_cache can retain that synthetic zero temporarily.
fix: Not applied (diagnose-only mode). Suggested direction is to construct a valid exclusive end date for the current-day query and distinguish unavailable/incomplete billing data from a confirmed zero; add activation-day and allocation regression tests.
verification: Root cause confirmed by direct code-path computation (earlyReturn=true), read-only AWS tag inventory, and read-only Cost Explorer results showing $0.2750953323 tagged total and $0.2269578323 tagged EC2 spend for the suppressed current-day window. No application or external state was modified.
files_changed: []
