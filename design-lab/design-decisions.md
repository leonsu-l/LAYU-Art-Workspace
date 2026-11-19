# Design Decisions

## Decision: Isolated Design Lab via Multi-Entry Vite HTML (`dec-001-design-lab-isolation`)

- **Date:** 2026-11-18
- **Scope:** global / design-lab infrastructure
- **Status:** accepted
- **Context:** Production routes (`/`, `/gallery`, `/channels`, `/admin`, `/password`) sit behind `SessionGate` requiring an active authenticated Java backend session.
- **Decision:** Host the interactive Design Lab at `apps/web/design-lab.html` (`apps/web/src/design-lab/`), served at `/design-lab.html` by `npm run dev:web`, while keeping persistent decision/state docs in `design-lab/`.
- **Rationale:** Keeps production routing, `index.html`, `main.tsx`, and `dist/` build completely untouched while giving instant HMR, real TypeScript checking, shared `@nanobanana/shared` contracts, and mock-first multi-state previews.

## Decision: Genuine Material 3 Expressive Rebuild (`dec-002-m3-expressive-rebuild`)

- **Date:** 2026-11-18
- **Scope:** global / workbench composition & component language
- **Status:** accepted
- **Context:** First Design Lab draft over-corrected away from uniform pills into a bordered Linear/Shadcn style, drifting away from Material 3 Expressive. User requested rewriting the Design Lab in genuine Material 3 Expressive while retaining the improved product workflow, and identified outer-corner overshoot snapping when switching connected button selections.
- **Decision:** Use authentic Material 3 Expressive foundations plus overshoot-safe connected corner transitions:
  1. **Tonal Surface Stepping** (`surface` → `surface-container-low` → `surface-container` → `surface-container-high` → `surface-container-lowest`) instead of `1px` border boxes.
  2. **Connected Button Groups & Overshoot-Safe Shape Morphing**: exact half-height outer radii (`19px`/`18px`/`17px`/`16px`/`15px`) instead of `999px`, `cubic-bezier(0.2, 0, 0, 1)` on `border-radius`, and locked outer corners across default/hover/active/selected states.
  3. **M3 Expressive Split CTA Button**: primary generate pill-end + connected preset template menu trigger with radial pointer ripple (`useRipple`).
  4. **Authentic `m3_example.html` Select**: tonal filled trigger (`surface-container-high`, no border), ripple, rotating chevron circle, elevated `16px` menu, `12px` options with `secondary-container` check.

## Decision: Select Direction A & Expand Multi-Page Design System (`dec-003-direction-a-and-multipage-system`)

- **Date:** 2026-11-19
- **Scope:** global / multi-page architecture
- **Status:** accepted (pending Stage 6 production integration approval)
- **Context:** User selected Direction A (`Cobalt Studio` — cool slate neutral tonal ladder + Cobalt Primary + Warm Amber Tertiary), requested discarding Direction B, and asked for cohesive matching designs across all application pages.
- **Decision:** Prune Direction B (`editorial-stage`) from tokens, prototypes, and lab shell; keep unified M3 Top App Bar navigation across `/` (Workbench), `/gallery` (Cloud-only Gallery with 1px fade selection frame, centered checkbox, task-group delete safety hint, dialog preview), `/channels` (Shared/Private channel split master-detail editor with write-only key handling & catalog fetch), `/login` · `/password` (Sign in, invite registration, forced password update with 12–1024 char guidance), and `/admin` (6 cohesive M3 admin sub-tabs covering shared channels, user management & quota reset, invite codes, quota & queue settings, templates, and non-private usage telemetry).
## Decision: M3 Primary Underline Tabs + Mobile Swipe Pager (`dec-004-m3-primary-tabs-and-swipe-pager`)

- **Date:** 2026-11-19
- **Scope:** global / primary & sub-navigation bars
- **Status:** accepted (pending Stage 6 production integration approval)
- **Context:** User requested updating section switchers to match authentic Material 3 Primary Tabs (baseline hairline divider + primary-colored rounded underline pill indicator), binding horizontal swipe gestures on mobile to top-level section switching with synchronized slide animations on both mobile and desktop, while keeping sub-section bars manual-click only.
- **Decision:** Introduce `M3PrimaryTabs` (`fixed` and `scrollable` variants) using `ResizeObserver`-backed indicator glide (`translate3d` + elastic drag interpolation) across both primary navigation (`创作工作台`, `我的图库`, `自定义渠道`, `账号安全`, `站点管理`) and in-page sub-tabs (`/login · /password` views, `/admin` 6 sub-modules). Wrap top-level routes in a directional horizontal slide pager with real-time pointer/touch drag on mobile (`touch-action: pan-y`, input/dialog/scrollable guards, rubber-band boundaries, and seamless handoff to enter/exit keyframes), while sub-sections switch solely on manual click with subtle vertical fade.

## Decision: Floating M3 Snackbar for Action Feedback & Warnings (`dec-005-m3-snackbar-feedback`)

- **Date:** 2026-11-19
- **Scope:** global / notifications, feedback & alerts
- **Status:** accepted (pending Stage 6 production integration approval)
- **Context:** Action notices across Gallery, Channels, Account, Admin, and Workbench previously rendered inline banners that pushed layout content down on click. User asked to move transient notifications/warnings to an M3 Snackbar where appropriate without forcing blocking/safety UI into auto-hiding toasts.
- **Decision:** Add a unified Inverse-Surface `LabSnackbarHost` + `useSnackbar` controller (`info` / `success` / `warning` tones, hover/focus auto-dismiss pause, exit transition) for all transient operation results, downloads, template applications, task failure details, and cascade-deletion warnings. Deliberately keep persistent blocking/policy notices inline (`scenario === 'recovery'` deduplication banner, `scenario === 'blocker'` missing-channel alert, `/password` 12–1024 char security rule banner, and static footer policies).


