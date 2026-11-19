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
- **Decision:** Prune Direction B (`editorial-stage`) from tokens, prototypes, and lab shell; keep unified M3 Top App Bar navigation across `/` (Workbench), `/gallery` (Cloud-only Gallery excluding legacy browser storage UI, with static `20px` corner radius, `1px` fade-in selection outline via `::after`, dead-centered `22×22` checkmark, task-group delete safety hint, and full-viewport preview), `/channels` (Shared/Private channel split master-detail editor with write-only key handling & catalog fetch), `/login` · `/password` (Sign in, invite registration, forced password update with 12–1024 char guidance), and `/admin` (6 cohesive M3 admin sub-tabs covering shared channels, user management & quota reset, invite codes, quota & queue settings, templates, and non-private usage telemetry).

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

## Decision: Immersive Frosted Gallery Lightbox + App Launch Container Transform (`dec-006-gallery-immersive-launch-transition`)

- **Date:** 2026-11-19
- **Scope:** gallery lightbox preview
- **Status:** accepted (pending Stage 6 production integration approval)
- **Context:** Previous gallery preview dialog wrapped images in large solid headers/footers limiting visual ratio, and snapped open/closed in place. User asked for maximum image visual dominance with compact frosted edge overlays and a full-fidelity App Launch / Close container transform emerging from and collapsing back into the card thumbnail icon.
- **Decision:**
  1. **Immersive Viewport Lightbox**: Portal lightbox into `#lab-overlay-root` (`z-index: 220`, below Snackbar `z-index: 260` which lifts automatically above bottom caption dock), letting the artwork fill up to ~95% viewport height with translucent frosted top index/action pills and compact bottom caption dock (`hudVisible` click/eye toggle).
  2. **60fps Uniform-Scale + Parabolic `clip-path` Container Transform**: Compute exact FLIP uniform `cover` scale + dynamic `inset(... round ...)` clip-path in `lightboxTransition.ts` (`buildContainerMorphKeyframes`) using 28 sampled keyframes driven by decoupled non-linear M3 Expressive cubic-bezier curves (`uPos` leading `uScale`) over an upward quadratic Bezier parabolic trajectory on open (`340ms`) and tight return arc on close (`260ms`, retargeting to the active card even after browsing `←` / `→`, cleanly reversing with `fill: 'both'` if closed mid-open, keeping close fill until portal unmount to prevent post-close flash, and allowing instant interruption by `openPreview` / `stepPreview` during rapid switching) while temporarily hiding the underlying card thumbnail.

## Decision: Gallery Selected-Hover Color Harmony & M3 Expressive Shimmer Skeleton Loading (`dec-007-gallery-selected-hover-and-m3-shimmer-skeleton`)

- **Date:** 2026-11-19
- **Scope:** gallery card states + global loading/media placeholders
- **Status:** accepted (pending Stage 6 production integration approval)
- **Context:**
  1. In `/gallery`, `.galleryCard:hover` (`(0,2,0)`) overrode `.galleryCardSelected` (`(0,1,0)`), causing selected blue cards to revert to the neutral unselected hover surface when hovered (same specificity issue existed on Workbench `.filmCard`).
  2. Unloaded pages, channel catalogs, and progressive media thumbnails lacked a unified Material 3 Expressive skeleton placeholder system.
- **Decision:**
  1. **Hover + Selected State Separation**: Scope unselected hover with `:hover:not(.galleryCardSelected)` (and `.filmCard:hover:not(.filmCardSelected)`), and introduce `--md-sys-color-secondary-container-hover` (`color-mix(in srgb, primary 12%, secondary-container)` `#C3D1FC` in light; `color-mix(in srgb, primary-container 24%, secondary-container)` `#324477` in dark) so hovered selected items remain blue and deepen subtly across both themes.
  2. **M3 Expressive Shimmer Skeleton Family (`LabSkeleton.tsx` / `LabSkeleton.module.css`)**: Implement GPU-composited (`translate3d`) Cobalt-tinted tonal shimmer skeletons (`SkeletonBlock`, `SkeletonTextStack`, `ShimmerImage`, `ConnectedRatioSkeleton`, `SplitCtaSkeleton`) matching M3 shape scales (circular avatars, pill text bars, M3 filled fields, connected matrices, Split CTAs, and `4:3` media frames with `prefers-reduced-motion` fallback), covering all 5 Design Lab pages, `ChannelModelBar` catalog discovery, and interactive Component Sandbox previews.

## Decision: Unified Shared Ripple Surface & Button Reuse (`dec-008-unified-m3-ripple-button-reuse`)

- **Date:** 2026-11-19
- **Scope:** global / all clickable interactive surfaces in Design Lab
- **Status:** accepted (pending Stage 6 production integration approval)
- **Context:** Previously, only a subset of controls in `LabControls.tsx` rendered M3 radial pointer ripples by manually duplicating `useRipple`, `<RippleOverlay>`, and CSS keyframes, leaving shell toggles, snackbars, gallery cards/actions, lightbox buttons, channel items, auth controls, and admin buttons without ripples.
- **Decision:** Centralize `RippleOverlay` and `RippleButton` in `apps/web/src/design-lab/components/LabRipple.tsx` + `LabRipple.module.css` reusing the shared `useRipple` hook (`apps/web/src/components/ui/useRipple.ts`), remove the duplicated ripple JSX/CSS from `LabControls.tsx`/`LabControls.module.css`, use zero-specificity `:where(.rippleHost)` so absolute/custom-positioned buttons (e.g. password toggle) stay intact, and replace every interactive `<button>` across `DesignLabApp`, `LabControls`, `LabSnackbar`, `WorkbenchPrototypes`, and `MultiPagePrototypes` (with `rippleTone="light"` for gallery artwork thumbnails).

## Decision: Image Retention, Private R2 Storage & Admin Issues Architecture (`dec-009-image-retention-storage-and-issues`)

- **Date:** 2026-11-19
- **Scope:** workbench (`/`), gallery (`/gallery`), and admin console (`/admin` storage & issues modules)
- **Status:** experimental (browser-verified in Design Lab; pending user review)
- **Context:** Backend added per-image/per-task retention expiry, independent admin storage policy & Cloudflare R2 private bucket configuration, dual-perspective bucket usage telemetry (application vs Cloudflare Analytics), and operational issue aggregation (`docs/IMAGE_STORAGE_FRONTEND_HANDOFF.md`).
- **Decision:**
  1. **User-Side Privacy & Retention Honesty (`/` & `/gallery`)**: Never expose storage location (`local` / `R2`), bucket identity, or fallback status to regular users. Display the top-level `retentionDays` policy even on an empty gallery, render each image/task's own `retentionDays` + local `expiresAt` promise (treating missing legacy fields as permanent without recalculating from `createdAt` or current policy), immediately drop stale previews upon image 404 while prompting list re-sync, and handle HTTP 410 on task recovery by clearing local pending submission without creating a new task.
  2. **Admin Storage & Dual Usage (`AdminStorageModule.tsx`)**: Keep `/api/admin/storage/settings` strictly separate from `/api/admin/settings` (quota/concurrency). Registering a new R2 bucket never auto-activates it; credential rotation omits untouched fields (never sending empty strings or masks) while offering an explicit `analyticsToken: null` clear toggle; bucket usage separates `application` (`imageCount`, `totalBytes`) from `cloudflare` (`payloadBytes`, `metadataBytes`, `objectCount`, `sampledAt`), rendering `—` rather than `0` for `not_configured` / `forbidden` / `no_data` / `unavailable`; deletion never infers safety from `imageCount === 0` and distinguishes HTTP 409 reference conflicts from retryable network failures.
  3. **Admin Operational Issues (`AdminIssuesModule.tsx`)**: Add live `openCount` badge on the `/admin` `问题日志` tab and header alert pill, filter by `open`/`resolved`/all with pagination, format Unix millisecond `firstSeen`/`lastSeen` timestamps, explain that `R2_FALLBACK` preserves user image access without retrying upstream, and make resolve/recurrence lifecycle interactive (`resolved` -> `open` with `occurrences + 1`).





