---
phase: 02-mindmap-preview
plan: 03
subsystem: map-components
tags: [components, ui, mindmap, tree-canvas, zoom-pan, svg-connections]
dependency_graph:
  requires:
    - phase: 02-02
      provides: NodeCard component (rendered per node inside TreeCanvas)
    - phase: 02-01
      provides: PrdTree type and Zustand store with tree data
  provides:
    - TreeCanvas component with column-based layout, SVG bezier connections, and zoom/pan
  affects: [MapPage (Plan 04 consumes TreeCanvas), PreviewDrawer (sibling in map layout)]
tech_stack:
  added: []
  patterns:
    - ref-based-zoom-pan (transformRef stores scale/tx/ty; applyTransform() writes DOM imperatively — bypasses React reconciler)
    - useLayoutEffect-for-svg-paths (getBoundingClientRect after paint; avoids stale layout reads)
    - nodeRefs-map (Map<string, HTMLDivElement> tracks node DOM elements for path calculation)
    - buildColumns-flat-to-grid (PrdTree flat map → PrdNode[][] column arrays; skips empty levels)
key_files:
  created:
    - src/components/map/TreeCanvas.tsx
  modified: []
decisions:
  - "Zoom stored in useRef not useState — MAP-06 compliance: tree prop changes and paths state updates cannot reset transform"
  - "SVG and columns both inside innerRef container — coordinate transform math divides by scale to get untransformed positions"
  - "buildColumns skips empty level arrays — MAP-04 adaptive columns: a tree with only root+level-1 produces exactly 2 columns"
  - "Pan guard uses closest('[data-node-card]') — pointer down on node cards does not start canvas drag"
patterns_established:
  - "Pattern: ref-based CSS transform zoom/pan — applyTransform() is sole DOM writer; React never sees transform in style prop"
  - "Pattern: useLayoutEffect SVG path recalculation — fires synchronously post-DOM-mutation; prevents stale getBoundingClientRect readings"
requirements_completed:
  - MAP-01
  - MAP-03
  - MAP-04
  - MAP-06
metrics:
  duration: 12m
  completed: "2026-05-26T14:10:00Z"
  tasks: 1
  files_created: 1
  files_modified: 0
---

# Phase 02 Plan 03: TreeCanvas Summary

Column-based tree canvas built with ref-driven CSS transform zoom/pan (MAP-06), useLayoutEffect SVG bezier connection paths, and adaptive column rendering that omits empty depth levels (MAP-04).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Build TreeCanvas with column layout, zoom/pan, and SVG connections | 7aa2b49 | src/components/map/TreeCanvas.tsx |

## Component Details

### TreeCanvas (7aa2b49)

**buildColumns:**
- Groups PrdTree nodes into at most 3 columns: roots (parentId===null), level-1 nodes, level-2+ nodes
- Each group is only pushed to columns array if non-empty — a tree with no level-2+ nodes produces 2 columns, a tree with only a root produces 1 column (MAP-04 adaptive rendering)

**Zoom/pan (MAP-06 compliant):**
- `transformRef = useRef({ scale: 1, tx: 0, ty: 0 })` holds transform state
- `applyTransform()` writes `innerRef.current.style.transform` imperatively — React never reads or writes the transform property
- handleZoomIn/Out clamp scale to [0.3, 3]; handleFitScreen resets to {1,0,0}
- Pointer events on outer wrapper handle pan; `closest('[data-node-card]')` guard prevents drag starting on node clicks
- `setPointerCapture` ensures pan continues even if pointer moves outside wrapper

**SVG paths:**
- `useLayoutEffect` fires after DOM mutations, before repaint — reads getBoundingClientRect on each nodeRefs entry
- Coordinates divided by current scale to convert screen→untransformed-container space
- Bezier: `M px py C midX py, midX cy, cx cy` — exits parent right edge, enters child left edge

**Zoom controls:**
- Three buttons (zoom_out, fit_screen, zoom_in) in absolute div at bottom-right
- Positioned OUTSIDE innerRef so they are unaffected by the CSS transform

## Acceptance Criteria Verification

- `export function TreeCanvas`: 1 match
- `buildColumns`: 2 matches (definition + call in useMemo)
- `transformRef`: 13 matches (useRef + applyTransform reads + zoom handlers + pan handlers)
- `useLayoutEffect`: 2 matches (import + usage)
- `getBoundingClientRect`: 3 matches (canvasRect + parentRect + childRect)
- `svg-line`: 1 match
- `NodeCard`: 2 matches (import + JSX usage)
- `zoom_in|zoom_out|fit_screen`: 3 matches
- `useState`: 2 matches (import + paths state) — zoom is NOT in state
- `useState.*scale|useState.*zoom|useState.*transform`: 0 matches (zoom not in state, MAP-06 verified)
- `innerRef.current.style.transform`: 2 matches (transform + transformOrigin assignments — both imperative)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — TreeCanvas renders all nodes from the `tree` prop with no hardcoded placeholder data.

## Self-Check: PASSED

- src/components/map/TreeCanvas.tsx: FOUND
- commit 7aa2b49 (TreeCanvas): FOUND
- `npx tsc --noEmit`: passed with no errors
- zoom NOT in useState: confirmed (0 matches for useState.*scale|zoom|transform)
