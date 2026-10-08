# Admin

This module owns site administration and organization-level management functionality. It handles access requests, organization bootstrapping, admin-level feature flags, page views, and high-level site statistics and costs (e.g. Azure).

**Does not own:** User authentication flows or individual user account settings.

**Key files:**

- `admin.ts`, `organization-settings.ts`, `admin-account-access.ts`: Core admin and organization management logic, including account subscriptions and role changes.
- `access-requests.ts`, `access-request-mail.ts`: Handling workspace or site access requests.
- `admin-stats.ts`: High-level site usage and reporting.

- `admin-plan-summary.ts`: Effective account/subscriber counts and dated Azure VM/saved-disk retail estimates; includes administrators in plan counts but excludes them from allowance cost estimates; does not replace actual spend reporting.
