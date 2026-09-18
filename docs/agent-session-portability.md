# Provider-neutral agent session portability

Status: Current for the Capsule v0 contract foundation. Durable storage,
repository restoration, provider rehydration, and launch are future work.

## Product model

An imported provider session first becomes a CoDev-native imported-session view.
From that view, a member will later choose one of two continuation paths:

```text
Imported provider session
        |
CoDev-native imported-session view
        |
Choose continuation
   /                     \\
Continue in CoDev     Resume original provider
fresh managed session exact native resume, when supported
any connected provider same source provider only
```

A managed continuation is a new CoDev agent session. It receives the normalized
transcript, current objective, handoff summary, and eventually restored repository
state, but it is not an exact continuation of the original provider transcript.
Native resume is provider-specific: a Codex import can only exactly resume in
Codex, a Claude import in Claude, and a Cursor import in Cursor.

## Capsule v0 boundary

`@codev/contracts` owns `SessionCapsuleV0`, a versioned, provider-neutral
manifest. It contains repository identity without credentials, a normalized
transcript, handoff data, repository-state file references, attachment references,
the source provider/session identity, and an opaque provider-payload reference.

Native files are attachments to the capsule, not generic fields. The generic
schema must not grow Codex rollout paths, `CODEX_HOME`, `session_meta`, Claude
configuration, Cursor configuration, credentials, OAuth tokens, global user
configuration, or absolute host paths.

The manifest permits regular files only and validates safe POSIX-relative paths,
unique paths, file roles, SHA-256 digests, a 500-file count, a 5 MiB per-file
limit, and a 25 MiB total plaintext limit. A future transport may package these
files differently, but must validate against the same manifest before storage.

## Adapter handoff

`SessionProviderAdapter` is the only provider-specific boundary. An adapter
inspects and exports native material, normalizes it into the CoDev transcript,
rehydrates native state into an authorized destination, and emits a native launch
recipe. Repository verification, worktree creation, patch application, storage,
access control, and continuation selection remain CoDev-owned behavior.

The Codex implementation owner should keep ownership of the existing Codex rollout
parser, import API route, tests, and dormant resume dialog. That work may consume
the shared contract, but must not introduce Codex-only fields into it.

## Deliberately deferred

Capsule persistence, encryption, archive/upload transport, import records,
repository restoration, runtime rehydration after IDE-home recreation, active
writer enforcement, and user-facing continuation selection are not implemented by
this contract-only milestone.
