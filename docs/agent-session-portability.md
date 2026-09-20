# Provider-neutral agent session portability

Status: Current for Capsule v0, durable storage, lifecycle, verified transport,
the provider-neutral repository restoration engine, Azure sandbox
materialization, and the scoped restore trigger. Provider rehydration and
launch are future work. The authenticated capsule intake route and importer
view are available.

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

The importer view displays the normalized transcript and handoff. Sharing that
view with other workspace members remains future work. The serialized artifact,
including opaque provider-native payload, remains importer-scoped. Audit events
contain metadata only, never capsule contents. Imports are retained until the
import or owning workspace is explicitly deleted; deleting an import physically
removes its encrypted artifact and leaves a soft-deleted metadata record for
lifecycle accounting.

Storage is idempotent per workspace, importing member, and caller-supplied key.
Reusing a key for a different capsule identity or lineage is rejected. A retry may
repair an import in `storing` or `failed`, but cannot move a later lifecycle
state backward.

## Capsule intake

An importer with workspace co-steering permission sends the complete Capsule
v0 transport as the raw body of
`POST /api/workspaces/{workspaceId}/session-imports`. The request uses
`Content-Type: application/vnd.codev.session-capsule.v0` and a caller-chosen
`Idempotency-Key` header. The route reads at most 32 MiB, checks the declared
content length when present, and decodes the transport before asking the
storage service to create the import. The storage service independently
verifies and encrypts the capsule. A repeat with the same key and capsule
identity returns the existing import; key reuse with different content is a
conflict.

The response contains the import ID and current lifecycle state, source
provider and session ID, transcript entry count, normalized handoff,
credential-free repository identity and restore status, and the restore actions
currently available. It never returns attachment bytes or provider-native
payload. Creation returns HTTP 201; an idempotent retry returns HTTP 200.

The importer opens `/workspaces/{workspaceId}/session-imports` to upload a
capsule or reopen one of their recent imports. The view decrypts and verifies
the stored capsule on the server, then presents its normalized handoff,
repository state, and the latest 50 transcript entries. Provider payload and
attachment bytes stay out of the page. Workspace members other than the
importer do not yet have a shared import view. Restoration can be retried from
this page, and transcript-only can be explicitly selected after a recorded
conflict or unavailable repository.

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

The concrete Azure sandbox adapter reserves the import worktree in PostgreSQL
before materializing that exact worktree ID at the capsule base commit. It uses a
purpose-built restore protocol rather than the general text-file API: `begin`
binds an idempotent operation to the import, worktree, base commit, and declared
file metadata; ordered `chunk` calls transfer at most 512 KiB; `finalize`
rechecks every size, SHA-256, mode, path, worktree HEAD, and cleanliness; and
`abort` removes incomplete staging.

Staging lives outside the worktree under the guest-owned Git area. Finalization
holds the guest's workspace mutation lock from preflight through application,
runs `git apply --check` before `git apply`, rejects existing destinations and
symbolic-link path components, and moves only approved regular files into the
worktree. Begin, chunks, and finalize tolerate safe retries, including a lost
response after successful finalization. Completed or conflicted operations keep
a small result receipt while staged payload bytes are removed. Any failed or
conflicted restore discards the isolated worktree; repository payloads,
attachments, and provider-native state never enter the protocol.

The importer can call `POST /api/workspaces/{workspaceId}/session-imports/{importId}/restore`
with workspace co-steering permission. The route checks that the import belongs
to that member and workspace, advances `stored` to `restoring`, decrypts and
re-verifies the stored capsule, wakes the sandbox, and runs repository restore.
It records `matched`, `restored`, `conflicted`, or `unavailable` through guarded
lifecycle transitions. Only the first two become `ready` automatically. A
separate call with `{ "transcriptOnly": true }` accepts a previously recorded
conflict or unavailability and then makes the import ready without a restored
repository. Transient runtime errors leave the import in `restoring` for retry;
after a conflict, retry reserves a new worktree and restore operation. An
`unavailable` repository can also be retried if its base commit later becomes
available; neither case silently selects transcript-only continuation.

## Deliberately deferred

Runtime rehydration after IDE-home recreation, provider launching, and the
managed or exact-native continuation choice are not implemented by this
milestone.
