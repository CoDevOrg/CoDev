# Workspace controls

This is the implementation contract for Gen 2 workspace controls. Agents and
human contributors should read it before adding or restyling controls.

## Reuse first

Use `WorkspaceButton` from `apps/web/components/gen2/workspace-button.tsx`
for workspace actions. It composes the existing shadcn Button; its appearance
is centralized in `apps/web/app/gen2/workspace.css`. It carries its own semantic theme tokens, so it also works in portaled dialogs.
Use `.gen2-workspace-surface` on workspace dialog content and
`.gen2-workspace-select` for native role selectors. Compose dialog close controls
with `DialogClose asChild` and `WorkspaceButton`, rather than a separately styled
close button.
Outside the workspace, use the shared shadcn Button and the surface's own theme.
Do not change the global Button to solve a workspace-specific styling issue.

```tsx
<WorkspaceButton tone="primary" size="action" onClick={createChat}>
  <Plus data-icon="inline-start" aria-hidden="true" />
  New Chat
</WorkspaceButton>
<WorkspaceButton tone="secondary" onClick={openSharing}>Share</WorkspaceButton>
<WorkspaceButton aria-pressed={boardOpen} onClick={toggleBoard}>Board</WorkspaceButton>
<WorkspaceButton size="icon" aria-label="Expand inspector" onClick={expandInspector}>
  <PanelRight aria-hidden="true" />
</WorkspaceButton>
```

## Hierarchy and geometry

- Primary: solid semantic accent; reserve for the main action in a region.
- Secondary: neutral surface and subtle border; use for actions such as Share.
- Destructive: semantic destructive fill for confirmed destructive actions.
- Ghost (default): transparent at rest; use for secondary toolbar actions.
- Informational status is text and an indicator, not a button-shaped box.
- Toolbar height: 32px. Main sidebar action and icon controls: 36px.
- Radius: 6px. Labels: 13px medium. Icons: 16px. Gap: 8px.
- Call-site classes own layout only. Do not override color, radius, type size,
  shadows, or interaction states. Extend the central component for reusable needs.
- Use semantic tokens; no per-button hardcoded blue, gradients, glows, or hover
  transforms. Use short color transitions and respect reduced motion.

## Interaction and navigation

Use `aria-pressed` for toggled actions, accessible names for icon buttons,
`disabled` for unavailable actions, and a stable-width progress indicator for
pending actions. Focus rings belong to `:focus-visible`, not the default state.
Render keyboard hints only for implemented shortcuts.

Chat navigation is a list: transparent rows, a quiet hover surface, and one
selected background. Do not stack selection outline, stripe, shadow, and tint.
Use `aria-current` for the current chat. Status labels must reflect known data;
unknown data must not be described as clean, online, or successful.

Tree items, tabs, suggestion cards, and activity disclosures are specialized
navigation/content controls; preserve their semantics and layouts. All ordinary
actions, including dialog footers, close controls, file menus, board actions,
terminal recovery, and chat actions, use `WorkspaceButton`. Workspace modules
are linted against importing the base Button directly.

## Review checklist

Before landing UI changes, review default, hover, pressed, keyboard focus,
disabled, and pending states. Check long labels, supported themes, narrow layouts,
and collapsed navigation. Check contrast and ensure touch surfaces provide
adequate targets (expand target padding to 44px where appropriate). Run affected
lint/type checks and existing behavior tests. Report whether the rendered UI was
actually inspected; source review alone is not visual verification.
