# Admin

This module owns site administration and organization-level management functionality. It handles access requests, organization bootstrapping, admin-level feature flags, page views, and high-level site statistics and costs (e.g. Azure).

**Does not own:** User authentication flows or individual user account settings.

**Key files:**

- `admin.ts`, `organization-settings.ts`: Core admin and organization management logic.
- `access-requests.ts`, `access-request-mail.ts`: Handling workspace or site access requests.
- `admin-stats.ts`: High-level site usage and reporting.
