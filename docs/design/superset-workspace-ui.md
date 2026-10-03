# Gen 2 Superset Workspace UI Design Contract

> **Status:** Design contract (audit of the current working tree)  
> **Target:** `/gen2/[workspaceId]/superset`  
> **Governing standards:** `AGENTS.md`, `docs/design/workspace-controls.md`, shadcn/ui  
> **Do not change product behavior.** Branch selection, worktree selection, sharing, Git, and agent runs keep their current meaning.

This document is the visual implementation contract. Another contributor should be able to restyle the shell from it without inventing a new direction. Findings below separate **observed rendered problems** from **code-based risks**.

---

## 0. Audit method and access limits

**Preview used:** `http://127.0.0.1:3000` (`next dev` in `apps/web`). The inspected workspace was already authenticated. A later pass measured the same page after the shell polish.

**Viewports measured with DevTools device metrics** (same authenticated page):

The first measured pass, before pixel rail caps, is historical: a ~2995px window gave a 599px sidebar and an 838px inspector because panel sizes were percentages. Current caps are in the table in section 1.

**Surfaces reviewed**

| Surface                                                    | Status                                                                                                                                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty chat                                                 | Observed. Heading “What should we build?”, composer, three suggestion cards, Codex send control. Sidebar: “No AI providers connected.”                                                              |
| Populated chat (user/assistant turns, markdown, streaming) | **Not accessed.** No connected provider; thread empty. Do not invent transcript chrome.                                                                                                             |
| Tool activity timeline                                     | **Not accessed.** Requires a running or completed agent turn.                                                                                                                                       |
| File editor                                                | Observed empty/loading: “Loading files…”, “Select a file to open it.” No file was opened; CodeMirror syntax on a real buffer was not inspected in this pass.                                        |
| Terminal                                                   | Observed collapsed dock (36px bar: Terminal, branch chip, Expand). Expanded xterm session **not opened** (would attach to the guest).                                                               |
| Changes / Review                                           | Observed only as hidden tab panels in the accessibility tree: “Working tree is clean” / “This branch has nothing to review yet.” Diff rows were not rendered.                                       |
| Branch / worktree menu                                     | Trigger observed in the top bar and sidebar. Open menu **not captured** in this pass.                                                                                                               |
| Sharing dialog                                             | Share control observed. Dialog **not opened** in this pass. Specify from `workspace-share-dialog.tsx` + `WorkspaceButton` contract, and verify after implementation.                                |
| Workspaces Board                                           | Control observed (`aria-pressed`). Board canvas **not opened** in this pass. Code uses a horizontal flex of five columns with `min-w-[260px]` and `overflow-x-auto`.                                |
| Light theme                                                | Theme toggle present. A later pass set `data-theme="light"` and measured cream `#f2e9d6` with navy text. Light secondary is `#465c91` inside this shell so 12px copy stays at least 4.5:1 on cream. |

---

## 1. Executive summary

The shell is already a quiet dark IDE: 48px top bar, left worktree/chat rail, center agent chat, right Files/Changes/Review inspector, bottom terminal dock. Top-bar **horizontal overflow is no longer the binding bug** at 768 and 390 (`scrollWidth === clientWidth`).

Verified layout after the polish pass (device metrics, dark unless noted):

| Viewport | Sidebar                | Chat  | Inspector | Notes                                                                                                |
| -------- | ---------------------- | ----- | --------- | ---------------------------------------------------------------------------------------------------- |
| 1440×900 | 288px                  | 750px | 400px     | No top-bar overflow. Light theme checked at this size.                                               |
| 1024×768 | 288px (still expanded) | 334px | 400px     | Session card hidden. Suggestions stack to one column. Sidebar did not auto-collapse in this browser. |

Rails use pixel caps (`288px` sidebar, `400px` inspector, `preserve-pixel-size`) so a wide window does not stretch them. Auto-collapse still runs from `matchMedia` in `useLayoutEffect`, plus a `ResizeObserver`, and is covered by the shell unit test. In this embedded browser the client effect did not stay attached (machine status remained “Checking…”, and `window` had no resize listener), so 1024px still showed both rails and a 334px chat. Do not treat that screenshot as proof that collapse works for a normal browser session.

Remaining gaps:

1. **Auto-collapse is implemented and unit-tested, and still needs a real window drag.** Device emulation here did not run the client effect, so 1024×768 kept both rails and a 334px chat. Suggestion cards correctly stack once the chat pane is under 640px.
2. **Chat rows are one 36px line.** Meta sits inline. Inspector tabs stay raw `role="tab"` buttons at 32px, which this contract allows.
3. **Context is still repeated** across the workspace name, branch pill, session card, and rail. Chat and the file inspector stay the large surfaces. The session card hides at ≤1279px.

---

## 1.1 Observed rendered problems

| Area             | Viewport                           | Observed defect                                                         | Evidence                                                                                                                                                                              |
| ---------------- | ---------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Center squeeze   | 768×900, 390×844                   | Chat stage 398px / 202px while sidebar + inspector remain open          | At 390, New Chat clips to “+ No”; Files tab label is truncated; suggestion cards become a 1-column stack inside ~200px.                                                               |
| Sidebar density  | 390×844                            | Expanded rail used as a full column instead of a 56px icon rail         | “ACTIVE WORKTREE” wraps; chat meta “0” sits on its own; Connect in Settings wraps to three lines.                                                                                     |
| Metadata stack   | 1024×768 and up                    | Too many peer status objects in the top bar                             | Brand “C”, workspace name, `main` pill, session card (“Initial Workspace Session”), Share, Board, “Machine: Ready”, theme, inspector. None is wrong; together they flatten hierarchy. |
| Empty-chat scale | All                                | Hero is quiet enough; supporting type is slightly small                 | Heading ~18px semibold (good). Suggestion descriptions `text-[11px]`. Composer body is the real content and should stay 14px.                                                         |
| Inspector empty  | All (this workspace)               | Files never left “Loading files…” during the session                    | Empty editor copy “Select a file to open it.” Changes/Review already have clean empty strings in the tree.                                                                            |
| Terminal dock    | All                                | Collapsed bar is usable; Expand/Collapse + branch chip compete for 36px | Observed 36px bar with 12px title, outline badge, muted Expand + chevron. Alignment is close; keep 36px and 12px/11px, do not drop to 10px.                                           |
| Status color     | Machine, branch, and working chips | Use `--ws-status-*`                                                     | Ready, working, and error dots are token colors. Unknown git status stays muted. “Ready” is shown only after the activity check reports connected.                                    |
| Light theme      | 1440×900                           | Cream canvas, navy type                                                 | Primary on cream is about 10:1. Secondary in this shell is `#465c91`, about 5.4:1. Dark secondary `#96918a` on `#070c1a` is about 6.2:1.                                              |

## 1.2 Code-based risks (not claimed as current pixels)

1. **Two workspace palettes.** `globals.css` still defines `--workspace-surface: #121417` and comments that the IDE is “permanently dark.” The live shell binds `--ws-*` to `--brand-paper` / `--brand-ink` (two-theme). Do **not** remap the Superset shell back to `#121417`; that fights `ThemeToggle` and the rest of the app.
2. **Auto-collapse may miss emulation / some resizes.** Layout effect listens to `matchMedia` `change` and `window` `resize`, then re-queries matches. Device emulation in this environment did not collapse rails. Implementation must keep a resize path and be verified with a real window drag.
3. **Bespoke controls remain.** `.gen2-worktree-trigger-btn`, `.gen2-sidebar-chat-card`, and `.gen2-ide-tabs button` are not `WorkspaceButton` / shadcn `Tabs`. `docs/design/workspace-controls.md` already allows specialized tabs/tree rows; still unify height (36px rows, 32px tabs) and hover/selected tokens.
4. **Inspector tabs are raw `role="tab"` buttons.** Hover/selected styles exist in CSS (32px, 6px radius, surface-3 selected). They are not shadcn `TabsList` / `TabsTrigger`. Keep tab semantics; restyle only.
5. **Board columns** are `flex` + `min-w-[260px]` + `overflow-x-auto`, not a 5-column CSS grid. Horizontal scroll is the intended compact behavior; add a visible overflow cue if columns clip without a scrollbar affordance.
6. **Editor theme** uses `var(--ss-background)` / `--brand-*` syntax colors, not a hardcoded `{ dark: true }` canvas. Light-theme editor contrast must be checked after a theme toggle, not assumed from the old cream-vs-dark-syntax report.

---

## 2. Visual direction and rationale

CoDev Superset is a hosted developer workspace. **Chat and code are the main content.** Branch and worktree controls stay visible because they change the guest filesystem the agent, editor, terminal, and Git share.

### Principles

- **One product, two themes.** Use `theme-tokens.css` `--brand-*` via `--ws-*` aliases. Light = paper cream + navy ink + blue accent. Dark = Midnight Blueprint (`#060a17` / `#0d152d` / `#131f42`) + ice ink + Miami blue accent + brushed brass. Toggle through existing `ThemeToggle`.
- **Three surfaces, no glass.** Canvas, panels, and raised controls differ by a small lightness shift and a 1px low-alpha border. No gradients, blurs, or large shadows.
- **One accent.** `--brand-accent` only for primary actions, focus, and the current selection. Status color only for machine/agent/git state.
- **Quiet type.** Geist Sans for UI and chat; Geist Mono for paths, branches, terminal, diffs. No oversized page titles inside the IDE.
- **Existing icon family.** `lucide-react` only.

---

## 3. Shell architecture

Persistent **48px** top bar. Body is three columns. Terminal docks **inside** the center column.

```
+----------------------------------------------------------------------------------+
| TOP BAR 48px  Surface 2                                                          |
| [rail] [C] Workspace  [branch pill]  |  [provider] session title  |  Share Board |
|                                      |                            |  machine  ☀  |
|                                      |                            |  inspector   |
+----------------------------------------------------------------------------------+
| LEFT RAIL Surface 2     | CENTER Surface 1                         | INSPECTOR   |
| 288px / 56px            | min 420px flex                           | 360–440 / 0 |
|                         |                                          |             |
| Worktree trigger 36px   | Chat history (flex, min-width 0)         | Files       |
| + New Chat 36px         | Composer (pinned)                        | Changes     |
| Recent chats 36px rows  | Terminal dock 36px / ~35% height         | Review      |
+----------------------------------------------------------------------------------+
```

```mermaid
graph TD
    A[SupersetWorkspaceShell] --> B[Top bar 48px]
    A --> C[Body]
    B --> B1[Workspace + branch]
    B --> B2[Session context]
    B --> B3[Share Board machine theme inspector]
    C --> D[Left rail]
    C --> E[Chat + terminal]
    C --> F[Inspector]
    D --> D1[Expanded 288px]
    D --> D2[Compact 56px]
    E --> E1[Chat]
    E --> E2[Composer]
    E --> E3[Terminal dock]
    F --> F1[Files]
    F --> F2[Changes]
    F --> F3[Review]
```

---

## 4. Semantic tokens

Bind only inside `.gen2-ide-container`, `.gen2-ide`, `.gen2-workspace-surface`, `.gen2-workspace-button`. Values come from `--brand-*` so light/dark stay in lockstep.

### Surfaces

| Role     | Token                 | Light                            | Dark      | Use                                         |
| -------- | --------------------- | -------------------------------- | --------- | ------------------------------------------- |
| Canvas   | `--ws-surface-1`      | `--brand-paper` `#f2e9d6`        | `#060a17` | Chat stage, editor, terminal body           |
| Panel    | `--ws-surface-2`      | `--brand-paper-bright` `#fffdf7` | `#0d152d` | Top bar, sidebar, inspector, dock bar       |
| Raised   | `--ws-surface-3`      | `--brand-paper-tan` `#e8dcc0`    | `#131f42` | Composer, session card, selected tab, menus |
| Hover    | `--ws-surface-hover`  | 8% ink on surface-2              | same mix  | Rows, ghost buttons                         |
| Selected | `--ws-surface-active` | 14% ink on surface-2             | same mix  | Current chat / branch                       |

### Text

| Role      | Token                 | Light                   | Dark      | Use                             |
| --------- | --------------------- | ----------------------- | --------- | ------------------------------- |
| Primary   | `--ws-text-primary`   | `--brand-ink` `#0e2f7e` | `#f4f6fb` | Chat, titles, inputs            |
| Secondary | `--ws-text-secondary` | `--brand-ink-muted`     | `#8ea3c7` | Meta, inactive tabs, file names |
| Muted     | `--ws-text-muted`     | `--brand-ink-faint`     | `#5c7094` | Placeholders, hints             |
| Inverse   | `--ws-text-inverse`   | `--brand-on-accent`     | `#060a17` | On solid accent                 |

### Borders and accent

| Role        | Token                | Use                                           |
| ----------- | -------------------- | --------------------------------------------- |
| Subtle      | `--ws-border-subtle` | `rgba(ink-rgb, 0.14–0.18)` panel rules        |
| Medium      | `--ws-border-medium` | Composer, cards, menus                        |
| Focus       | `--ws-border-focus`  | `--brand-accent`                              |
| Accent      | `--ws-accent`        | Primary button, brand mark, current indicator |
| Accent soft | `--ws-accent-soft`   | Selected chat wash                            |

### Status (only for real state)

| Role    | Token                 | Meaning                                                               |
| ------- | --------------------- | --------------------------------------------------------------------- |
| Ready   | `--ws-status-ready`   | `--brand-teal` — machine ready, clean tree when **known**             |
| Working | `--ws-status-working` | `--brand-orange` — booting, agent running, uncommitted when **known** |
| Error   | `--ws-status-error`   | `--brand-destructive` — failed command, machine error                 |

Unknown git/machine data stays muted text. Never label unknown as clean or online.

Bridge Tailwind/shadcn on the same subtree: `--color-background` → surface-1, `--color-primary` → accent, `--color-destructive` → error. Do not use `--workspace-surface` (`#121417`) in this shell.

---

## 5. Typography and spacing

**Sans:** Geist Sans, system UI fallback.  
**Mono:** Geist Mono, `ui-monospace` fallback.

| Element                   | Size            | Line height | Weight               | Family       |
| ------------------------- | --------------- | ----------- | -------------------- | ------------ |
| Session / workspace title | 14px            | 20px        | 600                  | Sans         |
| Section label (uppercase) | 11px            | 16px        | 600, tracking 0.05em | Sans         |
| Chat body                 | 14.5px          | 24px        | 400                  | Sans         |
| Composer                  | 14px            | 22px        | 400                  | Sans         |
| Empty hero                | 18px            | 24px        | 600                  | Sans         |
| Sidebar row title         | 13px            | 18px        | 500                  | Sans         |
| Meta / tabs / dock        | 12px            | 16px        | 400                  | Sans         |
| Suggestion supporting     | 12px (not 11px) | 16px        | 400                  | Sans         |
| Code / diff               | 13px            | 20px        | 400                  | Mono         |
| Terminal                  | 12px            | 18px        | 400                  | Mono         |
| Status chips              | 11px            | 14px        | 500                  | Mono or sans |

**Spacing (4px grid):** 4, 8, 12, 16, 24, 32.

- 4: icon-to-label, chip padding
- 8: toolbar gaps, compact row padding
- 12: sidebar inset, tab padding
- 16: chat block gap, panel padding
- 24: empty-state stack
- 32: composer clearance from dock

---

## 6. Control sizes and radius

Follow `docs/design/workspace-controls.md`. Ordinary actions use `WorkspaceButton`. Call sites own layout classes only.

| Control                                  | Height | Padding  | Radius                                                                                      |
| ---------------------------------------- | ------ | -------- | ------------------------------------------------------------------------------------------- |
| Toolbar (Share, Board, theme, inspector) | 32px   | 0 10px   | 6px                                                                                         |
| Icon button                              | 32×32  | 0        | 6px                                                                                         |
| New Chat                                 | 36px   | 0 12px   | 6px, accent fill                                                                            |
| Worktree trigger                         | 36px   | 0 10px   | 6px                                                                                         |
| Chat / branch row                        | 36px   | 6px 10px | 6px — **single line**; meta may sit inline, not a second wrapped block that grows past 36px |
| Inspector tabs                           | 32px   | 0 12px   | 6px                                                                                         |
| Inputs                                   | 32px   | 0 10px   | 6px                                                                                         |
| Status chip                              | 20px   | 0 6px    | 4px                                                                                         |
| Dialog / composer                        | —      | —        | 12px                                                                                        |
| Cards / menus                            | —      | —        | 8px                                                                                         |

Focus: 2px `--ws-accent` outline, 1px offset, `:focus-visible` only. Hover: 120ms color, no scale. Disabled: 45% opacity.

---

## 7. Navigation hierarchy

### Top bar (48px)

Three zones. Right zone `flex-shrink: 0`. Center truncates first. Left truncates next.

1. **Left:** back link to `/` (signed-in visitors land on the workspace list), 22×22 CoDev mark (`/brand/codev-mark-v3.png`, recolored with `--brand-logo-filter`), rail toggle, workspace name (13px semibold), branch pill (mono 12px).
   - ≤1023px: hide breadcrumb.
   - ≤768px: hide branch name/status; keep the pill as an icon button.
2. **Center:** session card (surface-3, 32px): provider mark, title max 240px (180px below 1440), working chip only while a turn is actually running. Hide the whole center at ≤1279px.
3. **Right:** Share (secondary), Board (`aria-pressed`), machine as **text + dot**, theme, inspector icon. The label is Checking…, Starting…, Ready, or Offline. Ready means the activity check returned connected. Offline keeps the dot and adds Reconnect.
   - ≤1279px: hide the session card.
   - ≤1023px: hide the breadcrumb and the machine word; keep the dot.
   - ≤768px: hide Share/Board labels, keep icons. Hide the branch name; keep the branch button.

Do not add extra badges. Do not duplicate the sidebar worktree status in the top bar if the pill already shows the branch.

### Left rail (288 / 56)

- Worktree trigger is the only branch control in the rail.
- New Chat is the only primary in the rail.
- Recent chats: transparent rows, hover = surface-hover, current = surface-active **or** accent-soft, not both. `aria-current` on the current chat. Rename sits at the row’s right edge (visible on hover, focus, or touch) and on double-click. The row pads so the time stays clear of the control. Enter saves only after the server accepts the title; Escape cancels. A rejected rename keeps the previous title.
- Compact 56px: icon buttons + tooltips; New Chat stays available.

### Inspector

- Tabs: Files, Changes, Review. Selected = surface-3 + 6px radius (no underline).
- Files: tree + editor, `min-width: 0`, shared guest paths.
- Changes / Review: empty copy already exists; diffs use teal/destructive, not extra badges.

### Board

Five columns, `min-width: 260px`, horizontal scroll with a visible scrollbar. Branch name is the card title; worktree id and provider stay secondary. Selected is one `--ws-surface-active` fill. Status color only on Working / Attention. Do not call a tree clean until git status has loaded.

### Share

`.gen2-workspace-surface`, 12px radius, `WorkspaceButton` close via `DialogClose asChild`. Invite field 32px. Native role select `.gen2-workspace-select`. Adding a person, changing editor/viewer access, copying a share link, and transferring ownership are separate. Transfer and remove use `AlertDialog` and do not claim success before the response. Restore focus to the control that opened the dialog.

---

## 8. States

| State                | Spec                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rest                 | Flat surfaces, no shadow.                                                                                                                                                                        |
| Hover                | `--ws-surface-hover`, 120ms.                                                                                                                                                                     |
| Pressed              | `--ws-surface-active`.                                                                                                                                                                           |
| Selected (lists)     | One fill. No outline + stripe + shadow.                                                                                                                                                          |
| Focus-visible        | 2px accent, 1px offset.                                                                                                                                                                          |
| Disabled             | 45% opacity, `pointer-events: none`.                                                                                                                                                             |
| Pending              | Spinner inside the same 32/36px control; width stable.                                                                                                                                           |
| Agent working        | Amber pulse **only** while `running`. Duration text: “Working for 14s”.                                                                                                                          |
| Empty chat           | 18px “What should we build?”, 13px muted explanation, composer, three suggestion cards (8px radius, 12px supporting type). Stack to one column below 640px of the **chat pane**, not the window. |
| Empty files          | Keep “Select a file to open it.” Do not fake a buffer.                                                                                                                                           |
| Empty changes/review | Keep truthful clean copy. Do not show “0 files” as a success badge unless git status was read.                                                                                                   |
| Error                | Surface-3 + 3px error stripe. Terminal failure: `Failed · exit 1` in `--ws-status-error`.                                                                                                        |
| Share dialog         | See the Share section above.                                                                                                                                                                     |

### 8.1 Chat transcript

Chat is the center column. Do not invent a second visual language for it.

- **Column:** `min(44rem, 100%)`, 16px vertical gap between turns. Chat body 14.5px / 24px. Composer 14px / 22px.
- **User:** right-aligned surface-3 bubble, 12px radius, 1px subtle border, no shadow. `whitespace-pre-wrap`.
- **Assistant:** flush left, no bubble. Markdown uses Geist Sans; code and tables stay inside the column (`overflow-x: auto` on pre/table, `min-width: 0` on the thread). Never `scrollIntoView` a sentinel — that moves ancestor viewports.
- **Authorship:** alignment is enough. Do not add avatars or a second metadata row.
- **Tool activity:** compact 12px rows. Completed turns collapse behind “Worked for Ns”. Live turns stay open with “Working for Ns” in `--ws-status-working`. Failed command detail uses `--ws-status-error` (`Failed · exit 1`). File paths are underlined accent links with `+/-/~` in status color. Command output is collapsed until the row is expanded, except a currently `running` step.
- **Composer:** one surface-3 field, 12px radius, 12px padding. Attachments are 8px chips above the textarea. Provider is a `DropdownMenu`. Send/Stop/Attach are 32px `WorkspaceButton`s with tooltips. Disabled opacity 45–50%. Focus-visible: 2px accent, 1px offset on the field.
- **Empty:** 18px “What should we build?”, 13px muted explanation, composer as the only primary action, three suggestion cards (8px radius, 12px supporting type). Cards fill the prompt and focus the textarea; they do not send. Stack to one column below 640px of the **chat pane**.
- **Scroll:** stick to the live edge while the user is within 80px of the bottom. Yield when they scroll up. “Jump to latest” appears only then. Pin to latest when sending or switching chats. History is a full-thread replace; there is no page-up pagination.
- **Error:** surface-3 + 3px `--ws-status-error` stripe, 12px text, dismiss control.

### 8.2 Files, editor, terminal, and review

These inspector and dock surfaces share the same `--ws-*` tokens as the shell and chat. Do not introduce a second editor or terminal palette.

- **File tree:** 32px rows, 16px icons, 12px indent per level, 13px labels that ellipsize. Selected uses one `--ws-surface-active` fill. Hover `--ws-surface-hover`. Secondary actions (`WorkspaceButton` + `DropdownMenu`) stay in the row: opacity 0 until hover, `:focus-within`, or an open menu. On `(hover: none)` they stay visible so touch users can still rename and delete. Keyboard users tab to the action even when it is visually quiet.
- **Tabs and toolbars:** 32px. Filename in the tab and the full path in the editor bar both ellipsize. Dirty is an 8px `--ws-status-working` dot, not a muted speckle. Save, copy, and file-create actions are `WorkspaceButton`s. Save/error/conflict notices use a 3px status stripe (`--ws-status-error` / `--ws-status-ready`).
- **Editor:** Keep CodeMirror (`SupersetCodeEditor`). Theme tokens are `--ws-surface-1`, `--ws-text-primary`, `--ws-accent-soft` selection, Geist Mono 13/20. Do not remount a different engine to restyle.
- **Terminal:** xterm background is the pane surface (`--ws-surface-1`). Do not leave xterm’s default black viewport. Text, cursor, selection, and ANSI colors come from `--ws-*` and the brand tokens. Font 13px Geist Mono, line-height 1.6, bar cursor. Dock bar stays 36px with a 12px title, an 11px branch pill, and a chevron, including while expanded. That bar is the only frame, along the top. The expanded shell runs flush to the bottom of the dock. Do not change session start/poll/resize behavior.
- **Review diffs:** `@pierre/diffs` **1.3.6** is compatible (React 19 peers; same version as `vendor/superset`). The viewer is a `next/dynamic` import (`ssr: false`) so Pierre/Shiki is not in the initial workspace bundle. `CodeView` virtualizes large patches. The worker pool is **deferred**: Next/webpack is not wired for `@pierre/diffs/worker`; highlighting runs on the main thread via `disableWorkerPool`. Parse or render failure falls back to a styled `<pre>` of the patch. Unified is the default in the inspector; split is a toolbar toggle. Git status/diff APIs and changed-file navigation are unchanged.
- **Truthful Git states:** Do not report a clean tree until status has loaded. Loading, unavailable, untracked-only, and empty-diff copy are distinct.

---

## 9. Responsive behavior

Auto-collapse is **required** so the chat pane stays ≥420px whenever the window can allow it.

| Breakpoint | Grid                                                   | Sidebar                             | Inspector                                  | Top bar                                |
| ---------- | ------------------------------------------------------ | ----------------------------------- | ------------------------------------------ | -------------------------------------- |
| ≥1440      | `288px minmax(0,1fr) 400px`                            | Expanded                            | Expanded                                   | Full                                   |
| 1280–1439  | `288px minmax(0,1fr) 400px`                            | Expanded                            | Expanded                                   | Session title max 180px                |
| 1024–1279  | `56px minmax(0,1fr) 360px`                             | **56px rail**                       | Expanded                                   | Hide session card; compact breadcrumb  |
| 768–1023   | `56px minmax(0,1fr) 0`                                 | 56px rail                           | **Collapsed** (reopen from inspector icon) | Hide breadcrumb; machine dot only      |
| &lt;768    | `56px minmax(0,1fr)` until an off-canvas drawer exists | 56px rail (drawer is a later phase) | Collapsed                                  | Brand + branch icon; Share/Board icons |

User toggle pins the rail. Do not fight a pinned expand on a phone-sized window.

Implemented panel caps: sidebar `288px` (min 220, max 360), inspector `400px` (min 280, max 480), both `preserve-pixel-size`. The center panel fills what remains, with a 240px minimum so a phone-width window can still lay out. User toggle pins the rail.

---

## 10. Prioritized implementation checklist

Do not change APIs, git/worktree behavior, or provider flows. Restyle and collapse only.

1. **Make auto-collapse real on live resize**  
   Sidebar → 56px below 1280 and inspector → 0 below 1024. The shell test covers both queries, including worktree switching from the compact rail. A real window drag is still required: device emulation in this session did not run the client effect, and the 1024px chat stayed at 334px. At 1440×900 the pixel caps already keep chat at 750px.

2. **Compact rail content**  
   When collapsed, do not clip “New Chat” into “+ No”. Icon-only + tooltip.

3. **Finish top-bar density**  
   Keep the overflow fix. Drop redundant labels (machine word, repo breadcrumb) at the breakpoints above. Session card remains the only running-agent surface in the bar.

4. **Unify controls to WorkspaceButton geometry**  
   Worktree trigger already 36×6 — keep it, stop adding new raw buttons. Chat rows → 36px single-line. Inspector tabs stay `role="tab"` at 32px pills. Share dialog already uses `WorkspaceButton`; do not restyle the global `Button`.

5. **Replace raw status colors**  
   Done for the shell: machine, branch, and working indicators use `--ws-status-*`. Pulse animation is skipped under `prefers-reduced-motion`.

6. **Empty / loading polish**  
   Files: a quiet skeleton or the existing empty copy, not an infinite “Loading files…” with no error. Suggestion cards: 12px supporting type, 8px radius, `min-width: 0`.

7. **Terminal dock**  
   Keep the 36px bar, 12px title, 11px branch pill, and chevron when expanded. The bar is the top frame. The shell has no bottom frame. Expand/collapse remains the only dock action.

8. **Verify light theme and a real file buffer**  
   Light shell contrast is checked (cream canvas, navy primary ~10:1, secondary `#465c91` ~5.4:1). A real file buffer and syntax colors were not opened in this pass; files stayed on “Loading files…”. Do not fabricate a buffer.

9. **Off-canvas &lt;768 (last)**  
   Optional drawer. Until then, 56px rail + collapsed inspector is the contract.

---

## 11. Non-goals

- New fonts or icon packs
- Decorative gradients, glass, glow, large shadows
- Changing worktree, share, or agent runtime behavior
- Remapping this shell to `--workspace-surface` `#121417`
- Inventing populated chat, diffs, or terminal output for screenshots
