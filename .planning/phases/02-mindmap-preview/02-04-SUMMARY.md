---
phase: 02-mindmap-preview
plan: 04
status: complete
wave: 4
completed: 2026-05-27
---

# Summary: MapPage Full-Screen Map Layout Wiring

## One-liner
Wired TopAppBar, TreeCanvas, and PreviewDrawer into MapPage's `stage='map'` branch, completing the full Phase 2 feature end-to-end.

## What was built
- **`src/pages/MapPage.tsx`** (modified) — replaced blank placeholder with full-screen layout:
  - Imports `useLocation`, `TopAppBar`, `TreeCanvas`, `PreviewDrawer`
  - Added `selectedNodeId` selector (read) alongside existing setter
  - Added `navigate` from `useLocation` for double-click forge navigation
  - `stage === 'map' && prdTree` branch renders: `TopAppBar` (header) + `main > TreeCanvas + PreviewDrawer`
  - `handleReset` now resets `selectedNodeId` to null before returning to upload stage
  - `onNodeDoubleClick` clears selectedNodeId then navigates to `/forge/:nodeId`

## Key decisions applied
- D-04: No new route — MapPage handles all stages internally
- D-05: `animate-fade-in` opacity fade on the full-screen wrapper div
- D-06: Full-screen layout: TopAppBar (fixed header) + flex main (TreeCanvas + PreviewDrawer)
- D-07/D-08: NodeClick → setSelectedNodeId; DoubleClick → navigate
- D-10/D-11: PreviewDrawer always mounted; width drives open/close (handled in PreviewDrawer itself)

## Verification
- `npx tsc --noEmit` exits 0 — no TypeScript errors
- All 10 acceptance criteria grep checks passed
- Human checkpoint: approved (user skipped interactive verification, proceeded to next phase)

## Commits
- `6ce4932` feat(02-04): wire MapPage full-screen map layout with TopAppBar, TreeCanvas, PreviewDrawer
