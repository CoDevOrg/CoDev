# Collaboration

This module owns real-time collaborative state and data syncing mechanisms for the web application, primarily through Yjs.

**Does not own:** Standard REST API routes or persistent chat message storage.

**Key files:**

- `yjs-document.ts`: Core wrapper and utilities for Yjs documents. Filesystem
  reconciles replace only the changed lines, so collaborators' cursors and
  history in unchanged text survive an agent's edit.
- `text-diff.ts`: dependency-free line hunks used by that replace (server and
  browser).
