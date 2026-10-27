---
name: DevMoter Control Plane
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#3a3939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#bbcabf'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#86948a'
  outline-variant: '#3c4a42'
  surface-tint: '#4edea3'
  primary: '#4edea3'
  on-primary: '#003824'
  primary-container: '#10b981'
  on-primary-container: '#00422b'
  inverse-primary: '#006c49'
  secondary: '#68dba9'
  on-secondary: '#003825'
  secondary-container: '#25a475'
  on-secondary-container: '#00311f'
  tertiary: '#adc6ff'
  on-tertiary: '#002e6a'
  tertiary-container: '#71a1ff'
  on-tertiary-container: '#00367a'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#6ffbbe'
  primary-fixed-dim: '#4edea3'
  on-primary-fixed: '#002113'
  on-primary-fixed-variant: '#005236'
  secondary-fixed: '#85f8c4'
  secondary-fixed-dim: '#68dba9'
  on-secondary-fixed: '#002114'
  on-secondary-fixed-variant: '#005137'
  tertiary-fixed: '#d8e2ff'
  tertiary-fixed-dim: '#adc6ff'
  on-tertiary-fixed: '#001a42'
  on-tertiary-fixed-variant: '#004395'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
  canvas-base: '#0a0a0a'
  surface-panel: '#111111'
  surface-dock: '#151515'
  surface-card: '#141416'
  surface-elevated: '#161618'
  surface-hover: '#202023'
  border-hairline: '#222225'
  border-subtle: '#27272a'
  border-focus: '#10b981'
  text-primary: '#f4f4f5'
  text-secondary: '#a1a1aa'
  text-muted: '#71717a'
  text-dim: '#52525b'
  emerald-glow: rgba(16, 185, 129, 0.16)
  status-error: '#ef4444'
  status-warning: '#f59e0b'
  status-info: '#3b82f6'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 15px
    letterSpacing: 0em
  code-lg:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: -0.01em
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: -0.005em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
    letterSpacing: 0em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 12px
    letterSpacing: 0.04em
  label-badge:
    fontFamily: JetBrains Mono
    fontSize: 9px
    fontWeight: '600'
    lineHeight: 10px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.75rem
  gutter-desktop: 1rem
  margin: 0.75rem
  margin-desktop: 1rem
  space-2xs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.375rem
  space-md: 0.625rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

The design system establishes a high-density, developer-first command interface engineered for orchestrating autonomous AI coding agents, telemetry streams, and low-friction runtime execution. Inspired by modern cloud-native consoles, code intelligence tools, and terminal workspaces, the interface fuses industrial minimalism with crisp cybernetic precision.

### Brand Personality & Core Values
- **Extreme Operational Density:** Chrome is stripped to the structural minimum. Information density is prioritized over decorative whitespace, maximizing above-the-fold visibility for agent runtimes, diff graphs, and stdout pipes.
- **Deep Void Isolation:** Pitch-black canvas grounds absorb visual friction, eliminating eye fatigue during sustained operational shifts and focusing cognitive attention purely on code execution.
- **Instrument-Grade Precision:** Every boundary is defined by razor-sharp hairline dividers, exact monospaced metrics, and instantaneous micro-interactions.
- **Active Luminescence:** Controlled electric emerald signals cut through near-black surfaces to denote active runtime execution, verified git tree commits, and healthy agent health.

### Design Movement
The design system operates at the intersection of **Industrial Minimalism** and **Terminal Modernism**:
- Pure near-black layered planar geometry (`#0a0a0a` to `#161618`).
- High-contrast structural boundaries with 1px hairline wireframes (`#222225` and `#27272a`).
- Hyper-dense compact type scales pairing a utilitarian grotesque (`Inter`) with a code-centric monospace (`JetBrains Mono`).

## Colors

The palette is tuned specifically for sustained monitoring, deep code inspection, and low-light visual parsing. It relies on a calibrated staircase of near-black neutrals illuminated by a singular, vibrant emerald accent.

### Color Tokens & Roles
- **Canvas Base (`#0a0a0a`):** The absolute foundational viewport frame and root background.
- **Primary Accent (`#10b981`):** Electric Emerald. Used strictly for active agents, live compilation, pass states, confirmed diffs, primary actions, and focused cursor lines.
- **Secondary Accent (`#059669`):** Deep Emerald. Reserved for pressed states, filled active tracks, and subtle badge borders.
- **Tertiary Accent (`#3b82f6`):** Stream Blue. Denotes introspective tool invocations, external API routes, and contextual informational signals.
- **Neutral Stack:**
  - `surface-panel` (`#111111`): Pinned utility navigation docks and file trees.
  - `surface-dock` (`#151515`): Collapsible terminal bays and output panes.
  - `surface-card` (`#141416`): Telemetry inspection modules and code containers.
  - `surface-elevated` (`#161618`): Floating dialogs, search overlays, and command menus.
  - `surface-hover` (`#202023`): Active interactive item highlight.

### Text & Contrast Hierarchy
- **High-Contrast Value (`#f4f4f5`):** Reserved for primary code symbols, active agent names, and prominent command titles.
- **Secondary Readability (`#a1a1aa`):** Standard interface labels, terminal output, and table data.
- **Structural Muted (`#71717a` / `#52525b`):** Directory paths, line numbers, inactive flags, and monospaced timestamp keys.

### Diagnostics
- **Critical Failure (`#ef4444`):** Unhandled runtime exceptions, failed assertions, and build breaks.
- **Warning / Degraded (`#f59e0b`):** Context token limits nearing quota, throttling, and pending approvals.

## Typography

The typography system provides dense, fatigue-free scanning across massive code diffs, logs, and agent status feeds. It uses `Inter` for functional user interface surfaces and `JetBrains Mono` for all programmatic artifacts, counters, code segments, and operational telemetry.

### Typographic Hierarchy Rules
- **Proportional vs. Monospace Partitioning:** Every system label displaying variable numerical data, git commit hashes, token counts, execution timestamps, or syntax blocks must strictly render in `JetBrains Mono`. General interactive navigation labels, panel headers, and settings toggles use `Inter`.
- **Vertical Economy:** Line heights remain strictly pegged between `1.2x` and `1.4x` to eliminate superfluous vertical scroll drift across complex logs and split-pane viewports.
- **Micro-Scale Microcaps:** `label-sm` and `label-badge` are styled in uppercase with intentional positive tracking (`0.04em` to `0.05em`), acting as anchored visual waypoints for rapid scanning without competing with primary data.

## Layout & Spacing

The layout philosophy rejects floating, decorative website grids in favor of a docked, tile-based console architecture where space is continuously accounted for.

### Structural Shell Layout
- **Fixed Tool Dock:** Left-aligned 44px fixed icon ribbon anchored against the viewport edge.
- **Collapsible Panel Sidebars:** 220px to 260px docks for directory structures, active agent queues, and session histories.
- **Split Viewport Stage:** Fluid multi-column pane management (editor, graph observer, terminal drawer) adapting horizontally via drag splitters.
- **Zero-Margin Partitioning:** Viewport docks abut each other directly with `0px` ambient gap; functional zones are demarcated cleanly via `1px solid #222225`.

### Responsive Reflow Rules
- **Desktop (≥ 1280px):** Simultaneous quad-panel view (Dock, Agent Tree, Workspace, Inspector) fully expanded with `1rem` internal card margins.
- **Tablet / Compact Desktop (768px - 1279px):** Inspector auto-collapses into a floating overlay drawer; Agent Tree converts to an icon-expanded flyout.
- **Mobile (< 768px):** Single-pane view with bottom bar tab switching, stacked viewports, and full-width edge-to-edge drawers.

## Elevation & Depth

Visual hierarchy is established almost exclusively through tonal stair-stepping and hairline boundary contrast rather than heavy diffused shadows.

### Elevation Architecture
1. **Root Ground (Level 0 - `#0a0a0a`):** The deep-space foundational layer beneath all panels.
2. **Structural Panels (Level 1 - `#111111` to `#151515`):** Side navigation, pinned status bars, and terminal trays framed by `1px solid #222225`.
3. **Containers & Cards (Level 2 - `#141416` to `#161618`):** Code review cards, agent step nodes, and input wells framed by `1px solid #27272a`.
4. **Command Floating Surfaces (Level 3 - `#18181b`):** Command search bars (`Cmd+K`), contextual menus, and tooltips. These utilize a crisp border (`1px solid #333338`) reinforced with a directional deep shadow: `0 8px 24px -4px rgba(0, 0, 0, 0.8)`.

### Emerald Edge Illumination
To signal high-priority live operations without breaking dark-mode immersion, active components project a tight cybernetic glow:
- Border highlight: `1px solid #10b981`.
- Ambient luminescence: `box-shadow: 0 0 10px -2px rgba(16, 185, 129, 0.25)`.

## Shapes

The interface embraces tight, disciplined geometry with an intentional leaning toward structural square corners softened minimally for modern polish.

### Shape Language & Scale
- **Base Level (`1` / Soft):** Primary buttons, text inputs, code container blocks, tabs, and panel wrappers adhere to a uniform `0.25rem` (4px) corner radius.
- **Nested Controls (`rounded-sm` / 2px):** Checkboxes, inner segment switches, tiny code chips, and terminal scrollbars use a razor 2px corner radius.
- **Overlays (`rounded-lg` / 8px):** Command palettes, flyout popovers, and dialogs utilize an 8px radius to distinctively set floating planes apart from rigid tiled surfaces.
- **Status Pills (`9999px`):** System runtime pills, git commit tags, and execution badges are fully rounded to stand distinct from angular containers.

## Components

### Buttons
- **Primary Cyber:** Solid `#10b981` background, `#0a0a0a` text, semibold 600. Hover: `#059669` with `box-shadow: 0 0 10px rgba(16, 185, 129, 0.3)`. Active: `#047857`. Default height: 28px; micro height: 24px.
- **Secondary Surface:** Background `#161618`, border `1px solid #27272a`, text `#f4f4f5`. Hover: Background `#202023`, border `#333338`.
- **Ghost / Tool:** Transparent background, text `#a1a1aa`, 4px radius. Hover: Background `#151515`, text `#f4f4f5`.

### Chips & Status Badges
- **Live Agent Pill:** Full pill radius (`9999px`), padding `2px 8px`. Background `rgba(16, 185, 129, 0.1)`, border `1px solid rgba(16, 185, 129, 0.3)`, text `#10b981`, font `JetBrains Mono` 9px uppercase. Contains an active 5px glowing emerald dot (`box-shadow: 0 0 6px #10b981`).
- **Telemetry Parameter Chip:** Radius 4px, padding `2px 6px`. Background `#111111`, border `1px solid #222225`, text `#a1a1aa`, font `JetBrains Mono` 11px.

### Input Fields & Command Palettes
- **Console Inputs:** Background `#0a0a0a`, border `1px solid #27272a`, text `#f4f4f5`, radius 4px, height 30px, internal padding `0 8px`. Focus: Border `#10b981`, outline none, box-shadow `0 0 0 1px #10b981`.
- **Prefix Monograms:** Terminal prompt markers (`$`, `>_`) rendered in `JetBrains Mono` `#52525b`.

### Checkboxes & Switches
- **Checkboxes:** Size 14x14px, radius 2px. Unchecked: Background `#111111`, border `1px solid #27272a`. Checked: Background `#10b981`, border `#10b981`, checkmark glyph `#0a0a0a` 10px.
- **Toggle Switches:** Width 28px, height 16px, background `#222225`, radius 9999px. Active state: Background `#10b981`. Thumb is a 12px circle in `#f4f4f5`.

### Cards & Telemetry Panels
- **Panel Surface:** Background `#141416`, border `1px solid #222225`, radius 4px. Header bar: 32px height, bottom border `1px solid #222225`, background `#111111`, containing panel title in `Inter` 12px semibold with trailing monospaced counters.

### Lists & Tree Navigation
- **File & Agent Queues:** Item height 26px, padding `0 8px`. Hover: Background `#161618`. Selected item: Background `#161618`, text `#f4f4f5`, with a 2px full-height left border indicator in `#10b981`.