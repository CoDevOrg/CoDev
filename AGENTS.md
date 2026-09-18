# CoDev Repository Guidance

## Product

CoDev is a hosted website deployed on Vercel. Do not describe it as a downloadable desktop application.

## Documentation

[`docs/README.md`](docs/README.md) indexes every design, operations, and
planning document, with a status for each. Start there instead of listing or
grepping `docs/`. Documents in `docs/archive/` describe past designs: do not
act on them. The repository root holds only `README.md`, `AGENTS.md`,
`CLAUDE.md`, and `PRD.md`; new documents go under `docs/` and get a row in the
index.

## Required Commands

Run from the repository root. Node.js 24+. pnpm only.

- Install: `pnpm install`
- Develop website: `pnpm dev`
- Format check: `pnpm format:check`
- Lint: `pnpm lint`
- Type check: `pnpm typecheck`
- Unit tests: `pnpm test`
- Production build: `pnpm build`
- Browser tests: `pnpm test:e2e`
- Rust checks: `pnpm rust:check`
- Rebuild embedded Orca bundle: `pnpm orca:web`

## Verifying a Change

The full suites are expensive. Run them once, at the end — not per edit.

- Iterate with targeted runs. `apps/web`:
  `pnpm --filter @codev/web exec vitest run lib/<file>.test.ts`. `packages/ide`:
  `pnpm run ide:test:web` or `vitest run --config config/vitest.config.ts <path>`
  from that directory.
- Run `pnpm typecheck` and a full `pnpm test` **once**, when the change is
  otherwise finished. `apps/web` typechecks in ~20s cold and ~10s warm, and a
  full `apps/web` test run is ~45s; `packages/ide` is minutes, so that is the
  one to be sparing with.
- Search with ripgrep (the `Grep` tool), never `grep -r` from the repo root.
  `node_modules` is ~4 GB across two trees; a recursive grep times out before it
  finishes, while ripgrep answers the same question in about a second.
- The root `.ignore` keeps ripgrep out of generated and bulk files (the
  embedded IDE bundle in `apps/web/public/orca`, lockfiles, dependency patches,
  the ui-ux-pro-max dataset, the IDE task ledger). Git still tracks them; pass
  `--no-ignore-dot` or read the file directly when you need one.
- A `packages/ide` source change also needs `pnpm orca:web` (~90s) and the
  regenerated bundle committed with it. Batch IDE edits and rebuild once.
- `apps/web/.next/dev` is a dev-server cache that grows without bound — it has
  reached 5.4 GB here. Delete it when the tree feels slow; `pnpm dev` rebuilds
  it, and `.next/cache` (the production build cache) is worth keeping.

## Container Policy

Use Apple's open-source [container](https://github.com/apple/container) tool whenever local container execution is needed. Do not add Dockerfiles, Docker Compose configuration, or commands that require Docker.

## Runtime isolation

Firecracker sandboxes and per-workspace Orca IDE sessions do **not** share a filesystem.

- Backend-driven work (agent execution, worktrees, publication exports) uses **sandbox API routes**.
- Anything an interactive IDE session must see (terminals, Git, `codex resume`) lives only in that session. The embedded IDE reaches `apps/web` through the `postMessage` bridge (`packages/ide` `codev-bridge.ts` ↔ `components/codev-parent-bridge.ts`), which proxies to ordinary `/api/workspaces/{id}/...` routes; there is no separate `/ide` route family.

Preserve the split between the Vercel-hosted web control plane and the
Azure-hosted Firecracker/Orca infrastructure. The runtime is Azure only: the
EC2 implementation, the `CLOUD_PROVIDER` dispatch and the AWS account
resources are all gone. Do not describe the runtime as AWS-hosted, and do not
reintroduce a cloud-selection branch. The cloud-neutral half of the runtime
(the host bootstrap, the Orca build scripts) lives in `infra/runtime/`; the
Azure stack itself is `infra/azure/`.

## packages/ide

`packages/ide` is a self-contained Orca fork and is **not** in the root pnpm workspace.

- Do not include it in root recursive pnpm, Prettier, lint, or test commands.
- Use its own tooling when working in that directory.

## Engineering Conventions

- Follow sibling files in the same package. Do not invent a second pattern.
- Keep Next.js pages as Server Components unless browser state or event handlers require a client boundary.
- Validate data crossing service or persistence boundaries (existing Zod/contracts). Do not add unchecked ad hoc types at those boundaries.
- Keep secrets server-only and never use `NEXT_PUBLIC_` for credentials.
- Add or update tests with every behavior change.
- `apps/web` API routes are built with `withUser` / `withWorkspace` from
  `apps/web/lib/api-route.ts`: they handle sign-in (401), the workspace
  permission check (404/403), body parsing (`readJson`), and turning a thrown
  error into a response. Throw an error that carries a `status` (or `ApiError`)
  instead of building an error response by hand, and give an error class a
  `toResponse()` when its body needs more than `{ error }`. Do not copy the old
  `getApiUser()` + `try/catch` + `apiError` preamble into a new route.
- New tests default to the `node` environment. `apps/web/vitest.config.ts` splits
  `lib` and `app` (node, no setup file) from `components` (jsdom + Testing
  Library); route handler tests live next to the route as `route.test.ts`. A test
  that genuinely needs a DOM belongs under `components/`, or declares
  `// @vitest-environment jsdom` in its own docblock. Do not move the global
  default back — booting a DOM for pure-logic tests cost this suite 4x its
  runtime (253s to 45s) before the split.
- A dependency's type surface is a standing cost on every typecheck.
  `skipLibCheck` skips _checking_ `.d.ts` files but still parses and loads them:
  `@aws-sdk/client-ec2` was 1012 files — a fifth of the `apps/web` program — for
  one retired module, and taking it out of the program moved the typecheck from
  171s to 20s. Prefer the narrowest client that does the job, and retire a
  dependency in the same change as its last caller.
- The AWS SDK is gone from `apps/web` apart from `@aws-sdk/credential-providers`
  and `@ai-sdk/amazon-bedrock`, which serve **Bedrock as a member's own model
  provider** and have nothing to do with the retired runtime. Do not remove
  those two, and do not add the rest back.

## UI & Design (required skills)

Every change that touches the interface — pages, components, layout, spacing,
color, typography, motion, icons, or accessibility — must go through the two
design skills vendored into this repository. This is not optional and it is not
per-agent: anyone working in this repo, human or agent, uses both.

- **`.claude/skills/ui-ux-pro-max`** — UX and design-system intelligence.
  Consult it for style/color/typography selection, layout and responsive rules,
  accessibility and touch-target requirements, animation timing, and
  stack-specific implementation guidance. It ships a local searchable dataset:

  ```bash
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain ux
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --stack nextjs
  ```

  Requires Python 3 (standard library only, no network). Run it from the
  repository root.

- **`.claude/skills/apple-design`** — the visual language. CoDev's surfaces
  follow Apple-style minimalism: generous whitespace, restrained color, SF-like
  type scale, subtle depth and glass, and smooth, meaningful motion.

Both are checked in under `.claude/skills/`, so they are available to every
clone without any personal or global skill setup. `.claude/skills/` is the only
copy of the repo's skills: `.cursor/skills` and `.agents/skills` are symlinks
to it, so edit skills there and never add a second copy. Before delivering UI work,
run the skills' pre-delivery checklists (contrast, focus states, touch targets,
reduced motion, light **and** dark mode). Do not hand-roll design decisions in
this repo when a skill already answers them.

## Deploy & CI Cost Hygiene

`apps/web` deploys through the **Deploy web** GitHub Actions workflow
(`.github/workflows/deploy-web.yml`), which runs `vercel build` +
`vercel deploy --prebuilt` with a team token. Vercel's own Git integration is
turned off (`git.deploymentEnabled: false` in both `vercel.json` files) so a
push from any teammate deploys, not only the Vercel account owner's — it needs
the `VERCEL_TOKEN` repository secret. A branch push builds a Vercel preview,
and a push to `main` builds and promotes a production deployment. Build
minutes are the dominant cost on our Vercel bill and the budget is small, so
keep builds proportional to real change.

- **One commit per change.** When a `packages/ide` source change needs the
  embedded IDE bundle rebuilt, run `pnpm orca:web` and include the regenerated
  `apps/web/public/orca/**` output in the _same_ commit. Do not land a separate
  "regenerate the embedded IDE bundle" follow-up commit — it doubles every
  build for one change.
- **Do not push trivial commits to `main`** (comment/typo fixes, doc-only
  tweaks split off from code). Each one costs a full production build.
- **Prefer one push over many small pushes** to the same branch in quick
  succession while iterating.
- The **Deploy web** workflow only runs when a push touches `apps/web/**`,
  `packages/{config,contracts,db,shared-types}/**`, `pnpm-lock.yaml`,
  `package.json`, `pnpm-workspace.yaml`, or a `vercel.json`. Its `paths:`
  filter mirrors the Vercel Ignored Build Step (`scripts/vercel-ignore-build.sh`),
  kept as the reference list — update both together if the web app's workspace
  dependencies change. A commit that only touches `services/`, `infra/`,
  `docs/`, `.github/`, or `packages/ide/` source (without a regenerated bundle)
  builds no web deployment.

## Production Test Accounts

For authenticated production UI verification, credentials live in a local file
**outside this repository**. Do not commit, copy, log, screenshot, or paste them
into source, tests, or user-visible output unless the owner explicitly asks.

If login is required and no local credentials file is available, ask the owner.
Do not invent accounts.
