# CoDev Repository Guidance (Claude Code)

Read [`AGENTS.md`](AGENTS.md) first — it holds the product framing, required
commands, container policy, and engineering conventions that apply to every
agent working in this repo. The notes below are the points worth repeating for
Claude Code specifically.

## UI & Design skills are mandatory

Any interface work in this repo uses **both** vendored skills — see the
"UI & Design (required skills)" section of [`AGENTS.md`](AGENTS.md) for the full
rule. In short: `.claude/skills/ui-ux-pro-max` for UX, design-system, and
accessibility decisions (searchable via
`python3 .claude/skills/ui-ux-pro-max/scripts/search.py`), and
`.claude/skills/apple-design` for the Apple-style visual language. They are
checked into `.claude/skills/`, so every session in this repo has them; use them
instead of improvising design decisions.

## Deploy & CI Cost Hygiene

Every branch push builds a Vercel preview and every push to `main` builds a
production deployment. Build minutes are the dominant cost on our Vercel bill
and the budget is small.

- **One commit per change.** When a `packages/ide` source change needs the
  embedded IDE bundle rebuilt, run `pnpm orca:web` and commit the regenerated
  `apps/web/public/orca/**` output _together with_ the source change. Never
  land a standalone "regenerate the embedded IDE bundle" follow-up commit — it
  doubles the build cost of a single change.
- **Keep trivial changes off `main`** as their own pushes (comment fixes,
  doc-only tweaks). Each push to `main` is a full production build.
- Commits touching only `services/`, `infra/`, `docs/`, `.github/`,
  `packages/ide/` source (with no regenerated bundle), or
  `packages/theia-extension/` are skipped by the Vercel Ignored Build Step at
  [`scripts/vercel-ignore-build.sh`](scripts/vercel-ignore-build.sh). Update
  that script's watch list if the web app's workspace dependencies change.

## Shared working tree

Multiple agent sessions share this checkout and push straight to `main`. Pull
before starting, stage only the explicit paths you changed (never `git add -A`
/ `git commit -am`), and confirm `git status` shows only your files before
committing.
