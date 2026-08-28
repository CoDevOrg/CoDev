---
name: CoDev Shared Workbench
description: A clear, collaborative interface for people and AI agents working in one hosted multiplayer IDE.
colors:
  forest: "#0F3D2E"
  forest-deep: "#092A20"
  forest-soft: "#E8F0EC"
  action-orange: "#FF6A00"
  action-orange-hover: "#E85F00"
  agent-blue: "#2563EB"
  ink: "#0D0D0D"
  muted: "#4E5953"
  line: "#D9DFDC"
  canvas: "#F7F8F6"
  surface: "#FFFFFF"
  success: "#137A4B"
  danger: "#B83D32"
typography:
  display:
    fontFamily: "Geist Sans, Arial, sans-serif"
    fontSize: "clamp(3.5rem, 6.7vw, 5.75rem)"
    fontWeight: 760
    lineHeight: 0.9
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Geist Sans, Arial, sans-serif"
    fontSize: "clamp(2.5rem, 5vw, 4.75rem)"
    fontWeight: 730
    lineHeight: 0.96
    letterSpacing: "-0.04em"
  title:
    fontFamily: "Geist Sans, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Geist Sans, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 450
    lineHeight: 1.65
    letterSpacing: "normal"
  label:
    fontFamily: "Geist Sans, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 680
    lineHeight: 1.2
    letterSpacing: "normal"
rounded:
  compact: "6px"
  control: "8px"
  container: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  base: "16px"
  lg: "24px"
  xl: "32px"
  section: "96px"
components:
  button-primary:
    backgroundColor: "{colors.action-orange}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "16px 24px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.action-orange-hover}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.forest}"
    rounded: "{rounded.pill}"
    padding: "16px 24px"
    height: "48px"
  workspace-stage:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.container}"
    padding: "0px"
---

# Design System: CoDev Shared Workbench

## Overview

**Creative North Star: "The Shared Workbench"**

CoDev should feel like walking up to a bright team workbench where every person, agent, task, and change is already visible. The composition is direct and side-by-side: a decisive category statement sits beside a concrete shared workspace rather than making visitors decode an abstract promise. The system is precise enough for serious engineering work, human enough for a team room, and visibly active without becoming noisy.

The visual language is clean, neutral, and structural. Forest establishes trust and shared state, orange is reserved for decisive action, and blue identifies Codex without turning the entire surface into an AI-themed color field. Borders and spacing explain hierarchy before decoration does. Motion communicates live work and concurrency; it never exists only for spectacle.

This system explicitly rejects generic technical SaaS pages, dense enterprise explanation before product proof, dark terminal cosplay, neon AI gradients, glassmorphism, decorative code aesthetics, editorial-tech tropes, and downloadable desktop-product framing.

**Key Characteristics:**

- Immediate category clarity paired with visible product proof.
- Neutral white and soft-canvas surfaces with forest structure and rare orange action.
- Large, compact sans-serif headlines and readable body copy.
- Thin borders, restrained rounding, and almost-flat elevation.
- Semantic live state: people, agents, tasks, files, changes, and review status.
- CSS-first motion with a complete reduced-motion presentation.

## Colors

The palette is a bright workroom: forest carries identity and structure, orange creates one unmistakable action path, and blue is a functional agent identifier.

### Primary

- **Workbench Forest** (`forest`, #0F3D2E): Brand marks, structural emphasis, dark callouts, selected states, and stable shared-work context.
- **Deep Forest** (`forest-deep`, #092A20): High-contrast dark surfaces and the live-work footer inside the workspace stage.
- **Soft Forest** (`forest-soft`, #E8F0EC): Quiet selected rows and low-emphasis shared-state surfaces.

### Secondary

- **Action Orange** (`action-orange`, #FF6A00): Primary CTAs and small attention markers only. It is an action color, not a background theme.
- **Codex Blue** (`agent-blue`, #2563EB): Codex identity, keyboard focus, and selected technical state.

### Neutral

- **True Ink** (`ink`, #0D0D0D): Headlines and high-emphasis content.
- **Workroom Gray** (`muted`, #4E5953): Supporting copy that still passes WCAG AA on white.
- **Quiet Line** (`line`, #D9DFDC): Dividers, container outlines, and internal workspace structure.
- **Soft Canvas** (`canvas`, #F7F8F6): Alternating section and quiet control backgrounds.
- **Surface White** (`surface`, #FFFFFF): The dominant page and workspace surface.

**The Rare Orange Rule.** Orange appears on primary action and active-status details only; if it starts coloring whole sections, the hierarchy is broken.

**The Semantic Color Rule.** Forest means shared structure, blue means Codex or focus, and orange means Claude or action. Pair each color with a label, icon, or status text so color is never the only carrier of meaning.

## Typography

**Display Font:** Geist Sans (with Arial and sans-serif fallbacks)  
**Body Font:** Geist Sans (with Arial and sans-serif fallbacks)  
**Label/Mono Font:** Geist Mono only inside code and file-level product proof

**Character:** A single sans family keeps the site direct and collaborative. Tight display rhythm gives the category statement confidence; open body rhythm keeps the story easy to scan.

### Hierarchy

- **Display** (760, `clamp(3.5rem, 6.7vw, 5.75rem)`, 0.9): One first-view category statement per page. Never exceed 92px or tighten beyond -0.04em.
- **Headline** (730, `clamp(2.5rem, 5vw, 4.75rem)`, 0.96): Section-level claims with short line lengths.
- **Title** (700, 1.25rem, 1.2): Feature, workflow, and workspace task titles.
- **Body** (450, 1rem, 1.65): Explanatory copy, normally held between 45ch and 68ch.
- **Label** (680, 0.875rem, normal tracking): Category markers and compact UI labels; sentence case is the default.

**The Plain-Speech Rule.** Typography amplifies a concrete product statement; it never compensates for vague copy with italics, tiny uppercase mono labels, or ornamental hierarchy.

## Elevation

CoDev is flat by default. One restrained structural shadow (`0 8px 8px rgba(15, 61, 46, 0.08)`) lifts the hero workspace from the page; everything else uses border, tone, and overlap to communicate depth.

### Shadow Vocabulary

- **Workspace Lift** (`0 8px 8px rgba(15, 61, 46, 0.08)`): Reserved for the large live workspace stage when it needs separation from a white page.

**The One Lifted Object Rule.** A viewport may contain one intentionally lifted product object. If every card casts a shadow, remove the shadows and restore the border hierarchy.

## Components

### Buttons

- **Shape:** Confident pill controls (999px radius) with a minimum 44px touch target.
- **Primary:** Action Orange background, True Ink text, 16px by 24px padding, and a directional arrow when it advances the user.
- **Hover / Focus:** Darken orange to `action-orange-hover`, lift by 1px, and use a 3px Codex Blue focus outline with 3px offset.
- **Secondary:** White surface, 1px Workbench Forest border, forest text, and no shadow.

### Chips

- **Style:** Compact 6px-to-8px corners for repository branches, agent names, file types, and review status. Use a pale semantic surface plus explicit text.
- **State:** Status is always written (`Working`, `Live`, `Ready for review`); a colored dot may reinforce but never replace the label.

### Cards / Containers

- **Corner Style:** 16px for the main workspace stage; 6px-to-12px for controls and internal panels.
- **Background:** Surface White over Soft Canvas, with Deep Forest reserved for one high-contrast status or CTA region.
- **Shadow Strategy:** Only the workspace stage may use Workspace Lift.
- **Border:** Quiet Line at 1px defines every functional boundary.
- **Internal Padding:** 16px for compact UI, 24px-to-32px for narrative blocks.

### Navigation

- **Style:** A three-part desktop row with wordmark, short page anchors, and sign-in/action controls. Use plain 14px sans text, a thin animated underline, and a 1px bottom divider.
- **Mobile:** Keep the wordmark and primary CTA, hide explanatory anchors, and preserve a 44px touch target.

### Live Workspace Stage

The signature component is a semantic product proof, not a decorative mockup. It must show two named people directing two named agents in parallel, recognizable tasks and files, a shared repository, reviewable changes, and an explicit simultaneous-work statement. Agent responses may reveal with stepped CSS typing animation, but the complete sentences must exist as accessible HTML text at all times. Under `prefers-reduced-motion`, reveal all text immediately and remove carets and pulsing state.

## Do's and Don'ts

### Do:

- **Do** name the category in the first viewport: “multiplayer IDE for people and AI agents.”
- **Do** place concrete product proof beside the primary claim on desktop and immediately after it on mobile.
- **Do** make ownership, agent identity, active work, and shared state readable without technical interpretation.
- **Do** use Workbench Forest for structure, Action Orange for the primary action, and Codex Blue for focus and Codex identity.
- **Do** keep meaning-bearing copy at 16px or larger and maintain WCAG 2.2 AA contrast.
- **Do** preserve complete product meaning when motion is reduced or unavailable.

### Don't:

- **Don't** create “a generic technical SaaS page whose headline could describe any collaboration tool.”
- **Don't** use “dense enterprise copy that explains architecture before showing the product.”
- **Don't** use “dark terminal cosplay, neon AI gradients, glassmorphism, or decorative code aesthetics.”
- **Don't** use “editorial-tech styling built from italic serif headlines, tiny mono labels, numbered section scaffolding, and oversized whitespace.”
- **Don't** present CoDev as “a downloadable desktop product”; it is a hosted website.
- **Don't** build repeated floating-card grids when one semantic workspace or one short sequence can carry the story.
- **Don't** animate layout properties or hide meaning inside an animation; use transforms, opacity, or clip-based reveals only.
