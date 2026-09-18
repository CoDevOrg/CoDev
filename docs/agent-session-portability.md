# Provider-neutral agent session portability

Status: Current for Capsule v0, durable storage, lifecycle, verified transport,
and the provider-neutral repository restoration engine. Concrete sandbox
materialization, provider rehydration, and launch are future work.

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
limit, and a 25 MiB total plaintext limit.

## Capsule transport v0

The internal v0 transport has one unambiguous binary layout: an eight-byte
`CODEVSC0` header, a four-byte big-endian manifest length, the canonical UTF-8
manifest, then raw file bodies concatenated in manifest path order. It has no
second set of entry names, modes, or sizes that could disagree with the
manifest.

Before storage, CoDev bounds the whole transport to 32 MiB and the manifest to
6 MiB, validates Capsule v0, requires canonical manifest encoding, and verifies
that every declared body has the expected size and SHA-256. Missing, extra,
truncated, reordered, checksum-mismatched, or trailing content is rejected. The
decoder returns only manifest-declared logical paths and copied byte arrays; it
does not write to a filesystem.

## Adapter handoff

`SessionProviderAdapter` is the only provider-specific boundary. An adapter
inspects and exports native material, normalizes it into the CoDev transcript,
rehydrates native state into an authorized destination, and emits a native launch
recipe. Repository verification, worktree creation, patch application, storage,
access control, and continuation selection remain CoDev-owned behavior.

The Codex implementation owner should keep ownership of the existing Codex rollout
parser, import API route, tests, and dormant resume dialog. That work may consume
the shared contract, but must not introduce Codex-only fields into it.

## Durable import storage

An accepted import has two PostgreSQL records. `agent_session_imports` is the
queryable control-plane record: ownership, source identity, capsule version and
digest, lifecycle state, repository-restore state, lineage, and eventual links
to a worktree and managed agent session. `agent_session_import_artifacts` holds
the serialized capsule bytes separately so ordinary import queries never load
the large encrypted value.

The artifact is encrypted before it reaches PostgreSQL using the existing Azure
Key Vault envelope-encryption path in production. Its authenticated context is
bound to the organization, workspace, import, and importing member. CoDev checks
the SHA-256 digest and byte count again after decryption, limits stored artifacts
to 32 MiB, and refuses to read an artifact through a different scope. Local
development uses the configured development key and embeds the same context
fingerprint inside the encrypted envelope.

Capsule identity and artifact integrity are deliberately separate. The capsule
digest is computed from validated canonical manifest bytes: object keys are
stable, file entries are ordered by logical path, set-like path collections are
sorted, and transcript order is retained. The artifact digest covers the exact
serialized bytes stored in PostgreSQL. Therefore a retry of the same semantic
capsule can return the existing import even if a future transport frames those
bytes differently, without replacing the immutable stored artifact.

The normalized transcript and handoff will become workspace-visible when the
import view is built. The serialized artifact, including opaque provider-native
payload, remains importer-scoped. Audit events contain metadata only, never
capsule contents. Imports are retained until the import or owning workspace is
explicitly deleted; deleting an import physically removes its encrypted artifact
and leaves a soft-deleted metadata record for lifecycle accounting.

Storage is idempotent per workspace, importing member, and caller-supplied key.
Reusing a key for a different capsule identity or lineage is rejected. A retry may
repair an import in `storing` or `failed`, but cannot move a later lifecycle
state backward.

## Lifecycle and native-writer ownership

Lifecycle changes use compare-and-set updates: the expected current state must
still be present when PostgreSQL applies the update. This prevents two workers
from both advancing a stale import. Repeating the current state is an idempotent
no-op; skipping required stages or leaving `failed` or `deleted` is rejected.

The normal import path is `stored` → `restoring` → `ready` → `launching` →
`active`. An active or launching continuation can return to `ready` when its
writer is released. An import cannot become ready until repository handling has
finished as `matched`, `restored`, or `transcript_only`, and it cannot launch
until a continuation mode has been selected.

Repository results have their own guarded transitions and may change only while
the import is `restoring`. A missing or conflicted repository can explicitly
fall back to `transcript_only`; completed `restored` and `transcript_only`
results are immutable.

PostgreSQL enforces one launching or active exact native resume for each
importing-member, source-provider, and external-session tuple. This constraint
does not apply to fresh managed CoDev continuations, because those create a new
provider session rather than writing the imported native transcript. Forked
imports retain lineage but must receive their own native provider session before
they can run concurrently as native writers.

## Repository restoration boundary

Repository restoration consumes only a verified decoded capsule. It first
normalizes and compares the destination repository host and path, then confirms
the capsule base commit exists before asking the runtime for an isolated
worktree. A mismatch or missing commit performs no mutation and can be reported
as `unavailable` or explicitly accepted as `transcript_only`.

The provider-neutral restore engine passes only the declared Git patch and
approved `untracked_file` entries to the runtime. Attachments and opaque provider
payloads never cross that boundary. Patch or destination-file collisions return
`conflicted` and discard the partial worktree; an unchanged base returns
`matched`, while successfully materialized state returns `restored`.

The runtime operations are expressed through `SessionRepositoryRuntime` so the
same validation and outcome rules apply independently of how the Azure-hosted
sandbox API materializes binary files. The concrete sandbox mutation adapter and
public trigger remain separate delivery work.

## Deliberately deferred

The public upload API, concrete sandbox restoration adapter, runtime rehydration
after IDE-home recreation, provider launching, and user-facing continuation
selection are not implemented by this milestone.
