<div align="center">
  <img src="apps/web/public/brand/codev-mark-v3.png" alt="CoDev" width="96" />

# CoDev

**People and AI agents, building in the same room.**

[Visit CoDev](https://trycodev.com)

</div>

CoDev is a shared workspace for building software with your team and AI agents. It brings the repository, conversations, agent sessions, code changes, and reviews into one place so everyone can see the work as it happens.

Instead of AI coding being a private process on one developer's machine, CoDev makes it collaborative. Teammates can follow progress, contribute context, guide agents, and review changes together from the browser.

## Why CoDev

AI has made it faster to write code, but the work surrounding that code is still fragmented. Agent sessions happen in isolation, decisions disappear into chat histories, and teammates often see the result only after a pull request is opened.

CoDev gives the whole team a shared surface for understanding the problem, making changes, and deciding what ships. The goal is simple: less duplicated work, less context switching, and more shared momentum.

## What you can do

- **Open a repository in a cloud workspace.** Start from an existing GitHub project and work from any modern browser.
- **Build with AI agents.** Bring agents into the same workspace as the code and the people guiding them.
- **Collaborate in real time.** See who is present, share work in progress, and keep the team aligned while changes are being made.
- **Co-steer agent sessions.** Add context, adjust direction, and step in when an agent needs a human decision.
- **Inspect the work as it happens.** Follow terminal output, code changes, and agent activity without waiting for a final handoff.
- **Review before you ship.** Keep changes visible and reviewable from the first prompt through the final diff.

## A shared workflow

1. **Connect** a GitHub repository.
2. **Build** alongside your team and AI agents.
3. **Review** the changes together.
4. **Ship** with the context intact.

## Where CoDev is going

Our vision is to make the workspace—not the private chat or individual laptop—the place where engineering work lives. Every feature, bug, incident, migration, and customer escalation should have its own shared cloud environment where people and AI agents can investigate, build, review, and hand off work together.

These planned use cases describe the platform we are building toward:

- **A workspace for every task.** Turn a ticket or issue into a live environment containing its repository, branch, agents, conversations, decisions, edits, tests, and reviews.
- **A shared brain for every workspace.** Keep people and agents aware of what is being investigated, what has already been tried, what is changing, and where work overlaps.
- **Duplicate-work detection.** Recognize when two people or agents are solving the same problem—even when they describe it differently—and help them join forces or coordinate separate approaches.
- **Shared debugging and incident rooms.** Bring on-call engineers and investigation agents into one controlled environment with shared hypotheses, live debugging, approval gates, an incident timeline, and an automatic postmortem draft.
- **Collaborative agent orchestration.** Let specialized agents investigate, implement, test, review, and document in parallel without silently conflicting with one another.
- **AI governance and oversight.** Give organizations visibility into who started an agent, what it was asked to do, what it accessed, what it changed, how much it cost, and what required human approval.
- **Follow-the-sun handoffs.** Allow another engineer or team to continue from the exact code, runtime, agent, and decision state instead of reconstructing the work from a summary.
- **Earlier, continuous review.** Let senior engineers and reviewers guide plans, assumptions, agent behavior, and code changes before the pull request becomes expensive to rewrite.
- **Reusable engineering memory.** Turn completed workspaces into permission-aware knowledge about past fixes, failed approaches, architectural decisions, incidents, tests, and subject-matter experts.
- **Faster onboarding.** Help engineers understand an active task, its surrounding system, and its history by learning from the organization's real engineering work.
- **Security remediation rooms.** Coordinate restricted vulnerability investigations with isolated reproduction, controlled access, agent audit trails, and verified remediation.
- **Large migrations and refactors.** Coordinate related work across teams and repositories while tracking progress, repeated failures, compatibility patterns, and shared risks.
- **Customer escalation workspaces.** Connect support and engineering around reproducible customer issues, current investigation state, ownership, and resolution progress.
- **Internal platform self-service.** Give developers governed workspaces with approved templates, tools, credentials, policies, and human checkpoints.
- **Compliance and engineering evidence.** Preserve why a change was made, who or what contributed, which checks ran, and who approved the result.

The long-term goal is a permission-aware intelligence layer across tasks, repositories, and the organization—helping every developer and agent benefit from work that is already happening or has happened before.

Read the full [enterprise feature vision](./ENTERPRISE_FEATURES.md).

CoDev is hosted on the web at **[trycodev.com](https://trycodev.com)**. Domain email setup (Resend sending and ImprovMX receiving) is documented in [docs/EMAIL.md](./docs/EMAIL.md).
