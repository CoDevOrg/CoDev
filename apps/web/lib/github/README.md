# GitHub

This module owns the integration with GitHub, including repo linking and API interactions specific to GitHub.

**Does not own:** General user authentication or generic OAuth provider definitions.

**Key files:**

- `github.ts`: Core GitHub API utilities.
- `repository-tree.ts`: Committed file and folder names for one revision, without downloading contents.
- `github-link.ts`: Logic for linking repositories or issues.
