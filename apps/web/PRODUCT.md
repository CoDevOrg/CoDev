# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers, classmates, and software teams who need to build in the same cloud workspace with human collaborators and AI coding agents.

## Product Purpose

CoDev brings a repository, live workspace, people, agent sessions, conversations, code changes, and review into one shared browser experience. Success means collaborators can join quickly, understand what everyone and every agent is doing, coordinate overlapping work, and review changes without reconstructing context across separate tools.

## Positioning

CoDev makes the workspace—rather than a private agent chat or one developer's laptop—the shared place where human and AI work remains visible, steerable, and reviewable as it happens.

## Operating Context

Users connect GitHub repositories, invite collaborators with scoped roles, work inside a browser-hosted IDE, coordinate through presence and workspace channels, run agents in isolated worktrees, inspect activity, and review work before merging or publishing it.

## Capabilities and Constraints

- CoDev is a hosted website deployed on Vercel, not a downloadable desktop application.
- The web control plane and isolated workspace runtimes are separate systems; interactive IDE operations use the workspace IDE routes.
- Workspace roles include owner, co-steer, reviewer, and viewer.
- Production features can depend on authentication, persistence, and a reachable workspace runtime.
- Demonstration surfaces may use explicitly synthetic fixture data, but must not call or mutate production systems.

## Brand Commitments

CoDev uses the existing warm near-black interface, ivory typography, coral accent, restrained glass and depth, Geist typography, and concise product voice already established in the web application.

## Evidence on Hand

- Product positioning and workflows are documented in the repository README.
- Existing web components demonstrate workspace sharing, team presence and channels, Mission Control, write-claim collision handling, activity history, and review checkpoints.
- Demo identities, repositories, messages, metrics, and outcomes are synthetic unless backed by a real workspace.

## Product Principles

- Keep people and agents visible in the same working context.
- Make concurrent work understandable before it becomes a conflict.
- Preserve the path from prompt through review and handoff.
- Prefer reliable, inspectable collaboration over private or ephemeral automation.
- Never imply that simulated demo state is live production data.

## Accessibility & Inclusion

Web surfaces target WCAG AA, support keyboard navigation and visible focus, preserve readable contrast, and respect reduced-motion preferences.
