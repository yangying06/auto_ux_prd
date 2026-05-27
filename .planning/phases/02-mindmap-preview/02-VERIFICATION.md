---
phase: 02-mindmap-preview
verified: 2026-05-27T00:00:00Z
status: gaps_found
score: 7/8 requirements verified
gaps:
  - truth: "Status badges visible on all node card types (MAP-02)"
    status: partial
    reason: "StatusBadge only renders on feature/ui leaf nodes. Module nodes and the root node card have no badge, even though PrdNode.status exists on every node type."
    artifacts:
      - path: "src/components/map/NodeCard.tsx"
        issue: "Module card branch (lines 70-83) and root card branch (lines 51-67) do not include StatusBadge. Only the leaf/feature branch (line 96) renders StatusBadge."
    missing:
      - "Decide: either add a StatusBadge to module cards, or explicitly document that badges are leaf-only and update MAP-02 scope."
---

# Phase 02: Mindmap Preview — Verification Report

**Phase Goal:** Users can see the full decomposed document tree as an interactive column-based tree visualization, with node status badges, zoom/pan/fit controls, and a right-side preview drawer that opens when a node is clicked. Double-clicking a node navigates directly to Deep Forge.

**Verified:** 2026-05-27
**Status:** gaps_found (1 partial, 7 pass)
**Re-verification:** No — initial verification

---

## Observable Truths — Results

| #  | Requirement | Status   | Evidence |
|----|-------------|----------|----------|
| 1  | MAP-01: Column tree renders all nodes from prdTree | PASS | `buildColumns` in TreeCanvas groups nodes into roots/level1/level2+ columns; all rendered via NodeCard |
| 2  | MAP-02: Status badges on node cards | WARN | Badge only appears on feature/ui leaf nodes; module and root card branches have no StatusBadge |
| 3  | MAP-03: Zoom-in, zoom-out, fit-screen controls functional | PASS | Three buttons call `handleZoomIn/Out/FitScreen`; mutate `transformRef.current`, call `applyTransform()` |
| 4  | MAP-04: Empty columns not rendered | PASS | `buildColumns` only pushes a column if its node array is non-empty |
| 5  | MAP-05: Forge Blueprint dark theme applied throughout | PASS | `tailwind.config.js` defines full dark token set; all components use `bg-surface`, `bg-background`, `text-on-surface` etc. |
| 6  | MAP-06: Zoom level survives prdTree updates | PASS | Zoom stored in `transformRef` (useRef), not state; re-renders from tree updates do not reset it |
| 7  | PRVW-01: Single-click opens PreviewDrawer | PASS | `onNodeClick` -> `setSelectedNodeId` -> `selectedNode` prop -> `PreviewDrawer` width CSS controlled by `isOpen` |
| 8  | PRVW-02: Drawer shows node summary and techNotes | PASS | `node.summary` rendered under "Extracted Context"; `node.techNotes` conditionally rendered under "Technical Implementation Notes" |
| 9  | PRVW-03: "Enter Deep Forge" navigates to /forge/:nodeId | PASS | Button calls `navigate('/forge/' + node.id)`; route registered in App.tsx |
| 10 | PRVW-04: Node ID badge visible in drawer | PASS | `{node.id}` in inline-flex badge element (PreviewDrawer.tsx line 41) |

**Score:** 7/8 pass (1 partial gap on MAP-02)

---

## Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/pages/MapPage.tsx` | VERIFIED | Full layout wiring: TopAppBar + TreeCanvas + PreviewDrawer for stage='map'; onViewMap sets stage |
| `src/components/map/TopAppBar.tsx` | VERIFIED | Renders header with "Upload PRD" button; `onUploadNew` prop wired |
| `src/components/map/NodeCard.tsx` | VERIFIED (partial) | Three card variants; StatusBadge only on leaf variant |
| `src/components/map/TreeCanvas.tsx` | VERIFIED | buildColumns, zoom controls, SVG paths, pan via pointer events |
| `src/components/map/PreviewDrawer.tsx` | VERIFIED | CSS width transition, ID badge, summary, techNotes, navigate button |
| `src/components/upload/TreeSummary.tsx` | VERIFIED | "查看导图" button calls `onViewMap` which sets stage='map' |
| `src/index.css` | VERIFIED | `.node-glow`, `.active-glow`, `.processing-glow`, `.svg-line`, `.animate-fade-in`, `.custom-scrollbar` all present |
| `src/store/appStore.ts` | VERIFIED | `selectedNodeId` state slice with `setSelectedNodeId` action; `prdTree` persisted |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| TreeSummary "查看导图" | MapPage stage='map' | `onViewMap` prop | WIRED | MapPage passes `handleViewMap` which calls `setStage('map')` |
| NodeCard click | selectedNodeId store | `onNodeClick` -> `setSelectedNodeId` | WIRED | MapPage reads `selectedNodeId` from store, passes callback to TreeCanvas->NodeCard |
| selectedNodeId | PreviewDrawer | `selectedNode = prdTree[selectedNodeId]` | WIRED | MapPage computes `selectedNode` and passes as `node` prop |
| PreviewDrawer "Enter Deep Forge" | /forge/:nodeId | `navigate('/forge/' + node.id)` | WIRED | Route registered in App.tsx; uses wouter hash router |
| NodeCard double-click | /forge/:nodeId | `onNodeDoubleClick` -> navigate | WIRED | NodeCard deduplicates click vs double-click via 300ms timer; MapPage wires double-click to navigate |
| TreeCanvas zoom buttons | CSS transform | `transformRef.current` + `applyTransform()` | WIRED | Direct DOM mutation via `innerRef.current.style.transform` |
| buildColumns | SVG paths | `useLayoutEffect` reads nodeRefs positions post-render | WIRED | Path recalculated on `tree` change using `getBoundingClientRect` |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| TreeCanvas | `tree: PrdTree` | Zustand `prdTree` (from decomposition polling / setPrdTree) | Yes — populated by `mergePartialTree` and `setPrdTree` from server poll | FLOWING |
| PreviewDrawer | `node: PrdNode \| null` | `prdTree[selectedNodeId]` computed in MapPage | Yes — lookup from live prdTree | FLOWING |
| NodeCard StatusBadge | `node.status` | Part of PrdNode from server decomposition | Yes — field set by server normalizer | FLOWING (leaf only) |

---

## Behavioral Spot-Checks

Step 7b: SKIPPED — requires a running Vite dev server and uploaded PRD to exercise the map stage. No runnable entry point can be invoked in a static check.

---

## Requirements Coverage

| Requirement | File | Description | Status | Evidence |
|-------------|------|-------------|--------|----------|
| MAP-01 | TreeCanvas.tsx | Column tree renders all nodes | SATISFIED | buildColumns covers roots, level1, level2+ |
| MAP-02 | NodeCard.tsx | Status badges on node cards | PARTIAL | Badge only on leaf/feature nodes, not module or root |
| MAP-03 | TreeCanvas.tsx | Zoom controls functional | SATISFIED | handleZoomIn/Out/FitScreen via transformRef |
| MAP-04 | TreeCanvas.tsx | Empty columns not rendered | SATISFIED | buildColumns guards each column push with length check |
| MAP-05 | tailwind.config.js + all components | Dark theme applied | SATISFIED | All surface/background tokens are dark; components use them |
| MAP-06 | TreeCanvas.tsx | Zoom survives prdTree updates | SATISFIED | transformRef is never reset by tree prop changes |
| PRVW-01 | MapPage.tsx + PreviewDrawer.tsx | Single-click opens drawer | SATISFIED | Click -> setSelectedNodeId -> isOpen drives CSS width |
| PRVW-02 | PreviewDrawer.tsx | Drawer shows summary and techNotes | SATISFIED | Both rendered; techNotes is conditional (correct) |
| PRVW-03 | PreviewDrawer.tsx | "Enter Deep Forge" navigates | SATISFIED | navigate('/forge/' + node.id) + route in App.tsx |
| PRVW-04 | PreviewDrawer.tsx | Node ID badge in drawer | SATISFIED | Inline badge renders node.id (line 41) |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| NodeCard.tsx | 70-83 | Module card renders no StatusBadge despite node.status existing | Warning | MAP-02 partially unmet — module-level nodes show no status |
| TreeCanvas.tsx | 17 | `level >= 2` groups all deep levels into one column | Info | Deep trees (level 3+) collapse into column 3; acceptable for MVP but may crowd layout |

No TODO/FIXME/placeholder stubs, no `return null` dead ends, no empty handlers found.

---

## Human Verification Required

### 1. Status badge coverage intent for MAP-02

**Test:** Upload a PRD, wait for decomposition, open the map view. Look at module-level cards (not the leaf/feature cards). Do they show a status badge?
**Expected per spec:** If MAP-02 intends badges on all node types, module cards should also display a badge.
**Why human:** Code decision (intentional design vs oversight) cannot be determined from static analysis alone.

### 2. SVG connection lines accuracy

**Test:** Open the map view with a multi-level tree. Verify bezier curves connect parent right-edge to child left-edge correctly at different zoom levels.
**Expected:** Lines remain visually correct when zoomed in/out or after panning.
**Why human:** `getBoundingClientRect` path calculation correctness requires visual inspection; the coordinate math involves `transformRef.current.scale` division but pan (tx/ty) is not factored into path computation — this may cause line misalignment after panning.

### 3. Pan + SVG line drift

**Test:** Pan the canvas (drag) then check if SVG connection lines remain aligned to node cards.
**Expected:** Lines stay attached to node edges.
**Why human:** The `useLayoutEffect` that recomputes paths only triggers on `tree` changes, not on pan events. After a manual pan, paths are NOT recalculated. This is a likely visual bug that only manifests during interaction.

---

## Gaps Summary

**MAP-02 (partial):** The `StatusBadge` component is correctly implemented with the orange "To Process" and green "Generated" states, but it is only mounted inside the leaf/feature card branch of `NodeCard`. The root node card (lines 51-67) and the module node card (lines 70-83) omit the badge entirely. Whether this is intentional (module-level status is not meaningful) or an oversight depends on the requirement intent. Until clarified, MAP-02 is marked WARN rather than FAIL because the badge *does* appear on the most important node type (leaf UI interaction nodes).

**SVG pan drift (not a requirement gap, flagged for human review):** The `useLayoutEffect` in TreeCanvas recalculates SVG paths only when `tree` changes. Pan operations update `transformRef` directly (bypassing React state) and do not trigger path recalculation. After panning, the SVG bezier curves will be visually displaced from their node targets. This is a visual fidelity issue that does not block core navigation functionality.

---

_Verified: 2026-05-27_
_Verifier: Claude (gsd-verifier)_
