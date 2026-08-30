# CoDev integration

Everything in this tree that exists because the IDE runs inside CoDev rather
than on someone's desktop. All of it is ordinary source now — before the fork
these were hunks in `infra/aws/orca-build/codev-web.patch`, re-applied over a
fresh upstream clone on every build.

Files added for CoDev are prefixed `Codev`/`codev-`, which makes them easy to
find: `git ls-files 'packages/ide/**/[Cc]odev*'`.

## Embedding contract

`apps/web/components/orca-workspace.tsx` boots this client in a same-origin
iframe and passes everything through the URL **fragment** — so the pairing
credential and bootstrap data never appear in HTTP requests, proxy logs, or
referrers:

| Fragment param | Meaning |
| --- | --- |
| `pairing` | Runtime pairing code for the workspace's `orca serve` |
| `codev=1` | Marks the client as CoDev-embedded |
| `codevProject` | Clone path, `/srv/codev/workspaces/<workspaceId>` |
| `codevProjectKind` | `git` or `folder` |
| `codevProjectName` | Repository name shown in the sidebar |
| `codevDefaultAgent` | Pins the default chat tab to `claude` or `codex` |
| `codevMemberId` | The signed-in member — **an id, never a credential** |
| `codevSettingsOnly` | Render the personal settings surface instead of the IDE |

`readCodevBootstrap` (`src/renderer/src/web/codev-bootstrap.ts`) parses these
and sets the `window.__CODEV_*` globals; `isCodevEmbedded()`
(`src/renderer/src/web/codev-embedded.ts`) is the guard the rest of the code
branches on, falling back to the `codev=1` fragment for callers that run before
`web/main.tsx` sets the flag.

Only the exact `/srv/codev/workspaces/<UUID>` path shape is accepted, so a
crafted fragment cannot point the client at an arbitrary directory.

## Parent bridge

`src/renderer/src/web/codev-bridge.ts` talks to the parent page over
same-origin `postMessage`. The parent
(`apps/web/components/codev-parent-bridge.ts`) verifies both the message origin
and the exact iframe window, then proxies each request to the matching
`/api/workspaces/:id/...` endpoint. GitHub and provider credentials stay
server-side and never cross the bridge.

It backs the CoDev panels: the team rail, path claims, the workboard, review
checkpoints, shared sessions, the activity audit, and the presence indicator.

## One left sidebar

A CoDev workspace is exactly one repository, so upstream's "Projects" header
has nothing to act on. `SidebarHeader.tsx` renders the repository name
(`window.__CODEV_PROJECT_NAME__`) in its place when embedded, leaving the
worktree list intact. `getStoredSettings()` also forces `experimentalActivity`
and `experimentalAgentDashboardPopout` **off** for embedded clients, removing
the sidebar's "Agents" entry and the dashboard popout — every agent already
appears in the right sidebar's "Live agents" tab.

The workspace's team rail — who is here, each person's focus (their own status,
else their agent's current task, else the file they have open), and the chat
channels — is `CodevTeamPanel.tsx`, mounted in that same left sidebar below the
worktree list, so the workspace shows a single left sidebar. It reads and writes
over the bridge (`team.roster`, `team.channels`, `team.messages`, `team.send`,
`team.createChannel`, `team.saveStatus`). Channels are backed by
`workspace_channels` / `workspace_channel_messages` and are readable and
writable by agents through the `read_team_chat` and `post_team_chat` tools; an
`@agent` mention queues the message plus recent channel context onto the
workspace's live agent session.

## Project bootstrap and repository picker

The orchestrator clones the workspace repository onto the runtime host at a
fixed path before the client starts. The client waits for its normal session
hydration, then invokes its typed `addRepoPath` runtime action directly
(`src/renderer/src/web/codev-project-bootstrap.ts`).

When embedded, the Add Project action sends the parent a
`codev:choose-repository` message instead of opening a local picker. The parent
shows the repositories from the user's authenticated GitHub installations, and
choosing one creates and opens its dedicated CoDev workspace.

## Default chat tab

Stock Orca opens a worktree on an idle terminal tab. CoDev workspaces are
agent-first, so `src/renderer/src/web/codev-default-chat-tab.ts` opens the
default checkout onto a **native chat tab**: right after the default checkout
becomes the active worktree it calls `launchAgentInNewTab` — the same path the
tab-bar quick-launch uses, so paired web-runtime sessions spawn the agent on the
host correctly — with `promptDelivery: 'draft'`, so the composer opens empty and
editable and nothing is auto-submitted. It runs once per project handoff, is a
no-op when the worktree already has an agent tab (a reload mirroring a running
session), and retires the stock terminal tabs afterwards (deferred, and never
the worktree's last tab).

What makes that tab render as chat is `experimentalNativeChat` /
`openAgentTabsInChatByDefault`. Both are forced **on** in `getStoredSettings()`
(`web-preload-api.ts`) whenever `isCodevEmbedded()`, so neither a stale
`localStorage` blob nor an unrelated `settings.set()` re-persisting the upstream
`false` default can leave a workspace showing a raw agent TUI.

The launched CLI also has to come up past its own first-run wizard, which the
chat surface cannot drive. `seed_claude_config` in
[`orca.rs`](../../services/orchestrator/src/backend/orca.rs) writes the
workspace user's Claude Code config before `orca serve` starts — two files,
because the CLI splits them: `~/.claude.json` carries `hasCompletedOnboarding`
and the per-project `hasTrustDialogAccepted`, `~/.claude/settings.json` carries
`theme`. Both merge non-destructively, so a member who later runs `claude` in a
terminal keeps their own choices. `bypassPermissionsModeAccepted` is
deliberately **not** seeded — pre-accepting a permissions bypass is a security
decision, not a first-run annoyance.

### Provider, model, and effort pickers

`CodevChatProviderPicker` (rendered by `NativeChatComposerActions` beside the
model and reasoning-effort pickers) switches a chat tab between Claude and
Codex. Each chat tab runs one agent CLI in its PTY, so a switch
(`src/renderer/src/web/codev-chat-provider-switch.ts`) starts a fresh chat on
the new provider in the same worktree and then retires the previous tab after a
short delay — skipped if that would leave the worktree with no tab.

Stock Orca only builds the model/effort picker surface once a tab has a live
PTY. CoDev opens the default chat tab *before* the paired host's PTY mirrors, so
`use-native-chat-session-options.ts` lifts that guard when embedded: the surface
is built in `'draft'` mode from catalog defaults so the pills show from first
paint, then re-created in `'live'` mode once the PTY arrives, which reconciles
any pre-PTY selection through the agent's own picker.

## Per-member agent subscriptions

A workspace is shared, but a linked coding subscription is personal. One
`orca serve` runs per workspace as one Linux user, so a credential in *that
process's* environment would necessarily be whichever member started the
session — which every other member's agents would then spend. Instead:

1. `write_member_agent_credentials`
   ([`orca.rs`](../../services/orchestrator/src/backend/orca.rs)) files each
   member's credentials under `~/.codev/agents/<memberId>/` (0600) when they
   open the workspace — including the join-an-existing-session path, the only
   path a second member ever takes. Codex gets its own `CODEX_HOME`; Claude's
   token goes in `env.json`. A member with nothing linked has any stale bundle
   removed, so a revoked credential stops being handed out.
2. The control plane returns `memberId` and puts it in the pairing fragment.
3. The renderer tags each launch with `CODEV_AGENT_MEMBER=<memberId>`
   (`launch-agent-in-new-tab.ts`).
4. The main process swaps that marker for the member's real environment at PTY
   spawn (`src/main/codev-member-agent-env.ts`, wired into `terminal.create` and
   `terminal.split`). The marker is always stripped; explicit launch values
   always win; a missing or corrupt bundle just means the agent prompts for
   sign-in rather than failing to launch.

The secret therefore never travels through the browser. Note this is per-member
**attribution, not isolation**: members share one Linux user, so it stops a
member from unknowingly spending someone else's subscription, but not a
determined one from reading the files. A real boundary needs a Linux user per
member.

## Settings surface

`src/renderer/src/components/settings/codev-personal-settings.ts` defines which
sections are personal. With `codevSettingsOnly=1`,
`filterPersonalSettingsSections` drops every workspace-scoped and `repo-*` pane,
leaving personal sections plus a CoDev-only **Profile** section that has no
upstream nav entry. In the ordinary in-workspace Settings screen, the CoDev
sections (`CodevProfileSection`, `CodevProviderConnectionsSection`,
`CodevWorkspaceInvitesSection`, `CodevWorkspaceMemberRolesSection`) appear
alongside the native ones, and `GeneralWorkspaceSettingsSection` is trimmed to
what a hosted workspace can actually act on.

## Theme and branding (outside this tree)

Two layers are applied to the built bundle rather than living here. Both are
CoDev-owned and neither is a patch any more, but they still run post-build:

- **Theme** — `apps/web/public/orca-theme-overrides.css`, injected into the
  iframe at load by `orca-workspace.tsx`. Retints shell surfaces and amber
  accents toward CoDev's deep-green / burnt-orange palette while leaving Monaco,
  terminal, and diff regions alone. Its selectors target compiled Tailwind class
  names, so re-check them after significant UI changes in here.
- **Branding** — `infra/aws/orca-build/brand-web.mjs` rewrites capitalized
  whole-word `Orca`/`ORCA` to `CoDev`/`CODEV` across non-locale chunks, swaps
  the logo module's data URI, and retitles the page. It also fixes the resulting
  "an CoDev" → "a CoDev" article mismatch.

  It deliberately leaves genuine identifiers alone — `orca.yaml`, `~/.orca`,
  `orca://pair`, the `orca` CLI binary, `orca-plugin.json`,
  `github.com/stablyai/orca`, and the `Orca Nerd Font Symbols` font family
  (renaming that alone would silently break Nerd Font glyphs in the terminal).
  Renaming the *display text* for these would send users looking for a `codev`
  command or a `codev.yaml` that doesn't exist.

`infra/aws/orca-build/codev-preload.js` is a classic script loaded before the
app's module script. It silences the "star us on GitHub" nag, normalizes the
`gh`-not-authenticated preflight banner (CoDev's sandbox is deliberately
credential-free and shows PRs through its own UI), and keeps one-time feature
tips and tours to once per browser rather than once per workspace — each
workspace is a separate `orca serve`, so hydration would otherwise resurrect
them on every entry.

`apps/web/components/orca-workspace.tsx` also renders a first-party
`workspace-topbar` above the iframe with a persistent "← CoDev" link back to
`/dashboard`. That is parent-page chrome, not part of this tree.

`apps/web/components/orca-project-tree.ts` predates the folded sidebar and
targeted authored class names (`.sidebar-header`, `.worktree-list`) that no
longer exist; `watchOrcaProjectTree` is now a no-op and should be deleted.

## Follow-up: the source rename

Now that this is first-party, the post-build branding rewrite can be retired in
favor of renaming in the source. Two tiers, in order:

1. **User-visible copy.** Fold `brand-web.mjs`'s replacements into the source
   strings, and cover what it currently misses: the non-English locale bundles
   (`es`/`ja`/`ko`/`zh`, ~600 `Orca` occurrences each, deliberately skipped) and
   lowercase UI mentions.
2. **Identifiers.** Rename the package, the `orca` CLI binary, `orca.yaml`,
   `~/.orca`, `orca://`, and `orca-plugin.json`. These are a coordinated change
   across this tree *and* the orchestrator, which spawns `orca serve` and reads
   these paths — and they are a migration for anyone with existing config, so
   they need a compatibility window rather than a rename in place.
