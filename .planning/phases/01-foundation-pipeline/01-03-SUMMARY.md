---
phase: 01-foundation-pipeline
plan: 03
subsystem: ui
tags: [react, tailwind, zustand, wouter, file-upload, polling]

requires:
  - phase: 01-01
    provides: PrdNode types, DecompositionStep type, store v4 with mergePartialTree/appendDecompositionStep/updateDecompositionStep/resetDecomposition
  - phase: 01-02
    provides: Express decomposition endpoints /api/decompose/start and /api/decompose/:sessionId

provides:
  - Upload-to-decomposition UI: drag-drop zone, file picker, live progress view
  - startDecomposition and pollDecomposition API helpers in src/lib/api.ts
  - UploadCard component with drag-drop, file picker, and inline error states
  - DecompProgress component with 4-state step list and live node count
  - MapPage landing page orchestrator with polling loop and store wiring

affects:
  - 01-04 (routing plan — MapPage is the upload route, wouter already installed)
  - phase 2+ (MapPage is the entry point for all PRD processing)

tech-stack:
  added: [wouter ^3.x (installed in this plan, used by MapPage for useLocation)]
  patterns:
    - navigateRef pattern for safe navigation inside async setInterval callbacks
    - Stage state machine (upload | decomposing | done | error) with conditional component swap
    - useAppStore.getState() for reading current store state inside polling callback (avoids stale closure)
    - Pure presentational components (UploadCard, DecompProgress) receive all data via props; store access only in orchestrator (MapPage)

key-files:
  created:
    - src/lib/api.ts (extended — startDecomposition, pollDecomposition, DecompositionPollResult)
    - src/components/upload/UploadCard.tsx
    - src/components/upload/DecompProgress.tsx
    - src/pages/MapPage.tsx
  modified:
    - index.html (added Material Symbols Outlined font CDN link)
    - package.json / package-lock.json (wouter added)

key-decisions:
  - "UploadCard renders as fragment (no outer wrapper) — card shell owned by MapPage, not child"
  - "navigateRef pattern used instead of direct navigate call to avoid stale closure in async polling"
  - "wouter installed in plan 03 (not 04 as originally planned) — MapPage requires it immediately"
  - "Material Symbols Outlined font added to index.html — required for all icon usage in upload components"

patterns-established:
  - "Pattern: orchestrator holds stage + async side effects; child components are pure presentational"
  - "Pattern: useAppStore.getState() for reading inside async callbacks (avoids stale Zustand closure)"
  - "Pattern: navigateRef — ref updated on every render, used in async context to get fresh navigate fn"

requirements-completed: [UPLD-01, UPLD-02, UPLD-03]

duration: 25min
completed: 2026-05-26
---

# Phase 01 Plan 03: Upload-to-Decomposition UI Summary

**Drag-drop file upload landing page with live decomposition progress, 4-state step list, and polling loop that merges PrdNodes into Zustand store incrementally**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-26T10:30:00Z
- **Completed:** 2026-05-26T10:55:00Z
- **Tasks:** 4
- **Files modified:** 6

## Accomplishments

- Upload card with drag-drop zone, native file picker, file type validation, and inline error states
- Live decomposition progress view with animated step list (pending/active/complete/error states per UI-SPEC)
- MapPage orchestrator: polling loop at 1500ms interval, incremental node merging, auto-navigate on completion
- Type-safe API helpers for both decomposition endpoints

## Task Commits

1. **Task 1: Add decomposition API helpers** - `19b5531` (feat)
2. **Task 2: Create UploadCard component** - `05c2992` (feat)
3. **Task 3: Create DecompProgress component** - `70fb691` (feat)
4. **Task 4: Create MapPage orchestrator** - `3a4bb63` (feat)

## Files Created/Modified

- `src/lib/api.ts` - Added startDecomposition, pollDecomposition, DecompositionPollResult; added PrdNode import
- `src/components/upload/UploadCard.tsx` - Drag-drop zone, file picker, FileReader, inline error state
- `src/components/upload/DecompProgress.tsx` - Step list with 4 states, pulse-dot header, node count badge
- `src/pages/MapPage.tsx` - Stage machine, polling loop, store wiring, navigation on completion
- `index.html` - Added Material Symbols Outlined font CDN link
- `package.json` / `package-lock.json` - wouter added as dependency

## Decisions Made

- UploadCard renders as a React fragment (no outer wrapper div) — the card shell (`bg-surface-container-low`, border, padding) is owned by MapPage's outer `div`, keeping the card shell consistent across stage transitions without re-mounting the shell element
- `navigateRef` pattern used so `navigate` from `useLocation` is always fresh inside the `setInterval` async callback
- `wouter` installed in this plan rather than plan 04 — MapPage requires `useLocation` immediately; no point deferring

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added Material Symbols Outlined font to index.html**
- **Found during:** Task 2 (UploadCard — all icons use material-symbols-outlined class)
- **Issue:** index.html only loaded Inter and JetBrains Mono fonts. Material Symbols Outlined was referenced in the UI-SPEC as the icon library but was not present in the HTML head. Without this link, all icon spans render as raw text (e.g., "account_tree", "upload_file")
- **Fix:** Added `<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet">` to index.html
- **Files modified:** `index.html`
- **Verification:** Font link present in index.html; UI-SPEC Open Question 1 explicitly called this out as a verification requirement
- **Committed in:** `19b5531` (Task 1 commit)

**2. [Rule 3 - Blocking] Installed wouter dependency**
- **Found during:** Task 4 (MapPage — imports useLocation from 'wouter')
- **Issue:** Plan noted "wouter is installed in Plan 04, but this file imports it here." wouter was not in package.json; the import would fail at build time
- **Fix:** `npm install wouter` — added to package.json as runtime dependency
- **Files modified:** `package.json`, `package-lock.json`
- **Verification:** `npx tsc --noEmit` passes; wouter in node_modules
- **Committed in:** `3a4bb63` (Task 4 commit)

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 blocking)
**Impact on plan:** Both auto-fixes essential for UI rendering and build success. No scope creep.

## Issues Encountered

None — TypeScript check (`npx tsc --noEmit`) passed cleanly after all 4 tasks.

## User Setup Required

None — no external service configuration required for these UI components.

## Next Phase Readiness

- Upload-to-decomposition UI complete; ready for routing plan (01-04) to wire MapPage into the app router
- wouter is already installed; Plan 04 can proceed directly to router setup
- MapPage currently stands alone — needs to be mounted as a route in the app's router to be accessible

---
*Phase: 01-foundation-pipeline*
*Completed: 2026-05-26*
