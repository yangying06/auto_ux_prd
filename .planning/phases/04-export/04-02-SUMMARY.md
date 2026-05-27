---
phase: "04-export"
plan: "02"
subsystem: "export-frontend"
tags: ["export", "TopAppBar", "MapPage", "canExport", "blob-download"]
dependency_graph:
  requires: ["POST /api/export-zip", "exportSpec()"]
  provides: ["Export button UI in TopAppBar", "canExport gate logic", "Blob URL download flow"]
  affects: ["src/components/map/TopAppBar.tsx", "src/pages/MapPage.tsx"]
tech_stack:
  added: []
  patterns: ["Blob URL download (createObjectURL + anchor click + revokeObjectURL)", "vacuous-truth guard on empty prdTree"]
key_files:
  created: []
  modified:
    - "src/components/map/TopAppBar.tsx"
    - "src/pages/MapPage.tsx"
decisions:
  - "Export button renders conditionally only when onExport prop is provided — maintains backwards compatibility"
  - "isExporting and exportError useState declared at MapPage top-level (React hooks rules), canExport and handleExport defined inside stage=map branch"
  - "vacuous-truth guard: Object.values(prdTree).length > 0 prevents empty-tree edge case from enabling export"
  - "URL.revokeObjectURL called after anchor click to prevent memory leak"
metrics:
  duration: "~2 minutes"
  completed: "2026-05-27T06:19:41Z"
  tasks_completed: 2
  files_modified: 2
---

# Phase 04 Plan 02: Export Button UI and MapPage Wiring Summary

**One-liner:** TopAppBar gains three optional export props rendering a gated "导出 Spec" button; MapPage computes canExport from leaf node statuses, manages isExporting state, and triggers Blob URL download via exportSpec().

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Extend TopAppBar with export button props and UI | 16cf9c8 | src/components/map/TopAppBar.tsx |
| 2 | Wire MapPage canExport computation and export download handler | c17d876 | src/pages/MapPage.tsx |
| 3 | Checkpoint: human-verify export end-to-end | (auto-approved) | — |

## What Was Built

### src/components/map/TopAppBar.tsx

Extended `TopAppBarProps` with three optional props:
- `canExport?: boolean` — controls button active/disabled state
- `onExport?: () => void` — button only renders when this is provided
- `isExporting?: boolean` — shows spinner + "生成中..." during fetch

Export button behavior:
- Renders LEFT of "Upload PRD" button when `onExport` is provided
- **Active state** (`canExport && !isExporting`): `bg-secondary-container text-on-secondary-container` — blue CTA matching Forge Blueprint design
- **Disabled state** (`!canExport || isExporting`): `opacity-40 cursor-not-allowed` with `title="所有节点完成后才能导出"` tooltip
- **Loading state** (`isExporting`): `animate-spin sync` icon + "生成中..." label, `disabled` attribute set

### src/pages/MapPage.tsx

Four surgical changes:

1. **Import**: `exportSpec` added to the `../lib/api` import line
2. **Top-level state**: `isExporting` and `exportError` useState declarations placed alongside other state hooks (not inside stage branch — React rules)
3. **Inside `stage === 'map'` branch**:
   - `canExport` computed: `Object.values(prdTree).length > 0 && all leaf nodes have status === 'done'`
   - `handleExport` async function: calls `exportSpec()`, creates Blob URL, triggers `<a>` click, calls `revokeObjectURL`
   - TopAppBar receives `canExport`, `onExport={handleExport}`, `isExporting` props
4. **Error banner**: rendered between TopAppBar and main when `exportError` is non-null; dismissible via X button

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `grep "canExport" src/components/map/TopAppBar.tsx` returns 5 lines (interface, destructure, disabled, title, conditional class)
- `grep "onExport" src/components/map/TopAppBar.tsx` returns 4 lines (interface, destructure, conditional render, onClick)
- `grep "opacity-40 cursor-not-allowed" src/components/map/TopAppBar.tsx` confirmed
- `grep "bg-secondary-container" src/components/map/TopAppBar.tsx` confirmed
- `grep "所有节点完成后才能导出" src/components/map/TopAppBar.tsx` confirmed
- `grep "animate-spin" src/components/map/TopAppBar.tsx` confirmed
- `grep "exportSpec" src/pages/MapPage.tsx` shows import and call site
- `grep "Object.values(prdTree).length > 0" src/pages/MapPage.tsx` confirms vacuous-truth guard
- `grep "createObjectURL" src/pages/MapPage.tsx` confirmed
- `grep "revokeObjectURL" src/pages/MapPage.tsx` confirmed
- `npx tsc -p tsconfig.app.json --noEmit` exits 0
- `npx tsc -b --noEmit` exits 0

## Known Stubs

None — the export feature is fully wired end-to-end: backend zip generation (Plan 01) + frontend button UI and download flow (Plan 02).

## Self-Check: PASSED

Files verified:
- FOUND: src/components/map/TopAppBar.tsx (modified)
- FOUND: src/pages/MapPage.tsx (modified)

Commits verified:
- FOUND: 16cf9c8 (feat(04-02): extend TopAppBar with export button props and UI)
- FOUND: c17d876 (feat(04-02): wire MapPage canExport computation and export download handler)
