# Phase 2: Mindmap & Preview - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can see the full decomposed document tree as an interactive column-based tree visualization, with node status badges, zoom/pan/fit controls, and a right-side preview drawer that opens when a node is clicked. Double-clicking a node navigates directly to Deep Forge. This phase delivers visual exploration only — AI polishing happens in Phase 3.

</domain>

<decisions>
## Implementation Decisions

### Rendering Approach
- **D-01:** Use **custom React tree component** that matches the design mockup (Image 2.html) exactly — column-based layout with CSS-styled boxes and SVG connection lines. Do NOT use markmap-view for visual rendering.
- **D-02:** `markmap-lib` may be used for its Transformer/tree utilities if needed for data conversion, but the visual output is pure React + CSS, not markmap SVG. The prdTree flat map from Zustand is the source of truth; convert to a hierarchical structure for rendering.
- **D-03:** Tree layout: columns correspond to tree depth levels (root column → module column → leaf column). SVG `<path>` elements drawn as connection lines between columns, matching the `svg-line` class pattern in the design mockup.

### MapPage Layout Transition
- **D-04:** MapPage handles all stages internally — no new route needed. Add a new `stage === 'map'` state after "done". The "查看导图" button in TreeSummary triggers transition to the map stage.
- **D-05:** Transition animation: centered card fades out (opacity 0), full-screen map layout fades in (opacity 1). No scale or translate animation — simple opacity fade only.
- **D-06:** Full-screen map layout includes: TopAppBar (fixed header with app name + "Upload PRD" button), left canvas (flex-1), right preview drawer (conditionally visible).

### Node Interaction Model
- **D-07:** **Single click** → open right-side preview drawer for the clicked node. `selectedNodeId` set in Zustand store.
- **D-08:** **Double click** → navigate directly to `#/forge/:nodeId` (bypasses preview drawer). Prevents single-click event from firing when double-clicking (standard dblclick debounce pattern).
- **D-09:** "Enter Deep Forge" button inside the preview drawer also navigates to `#/forge/:nodeId`.

### Preview Drawer
- **D-10:** Drawer is **closed by default** when entering map view. No right panel visible until a node is clicked.
- **D-11:** When a node is clicked, the drawer slides in from the right. The mindmap canvas shrinks from 100% to ~70% width. Transition: CSS width transition (300ms ease).
- **D-12:** Drawer shows: node title, node ID badge (e.g. PL-01), "Extracted Context" (node summary), "Technical Implementation Notes" (techNotes), "Enter Deep Forge" button at the bottom. Close button (×) hides the drawer.

### Zoom / Pan
- **Claude's Discretion:** Implement zoom/pan via CSS `transform: scale() translate()` on the tree container. The three zoom controls from the design mockup (zoom-out, fit-screen, zoom-in) map to: decrease scale, reset to fit the viewport, increase scale. Preserve zoom level across data updates (MAP-06).

### Status Badges
- **Claude's Discretion:** Map `PrdNode.status` to badge visuals:
  - `status: 'pending'` → "To Process" orange badge (matching `processing-glow` + `#ff5429` border style in mockup)
  - `status: 'done'` → "Generated" green badge (matching `tertiary` color + `check_circle` icon in mockup)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design Mockup (Primary Reference)
- `stitch/main/Image 2.html` — **The canonical UI spec** for this phase. Full HTML+CSS implementation of the map view. All layout measurements, color tokens, component structure, and interaction hints come from here.
- `stitch/main/Image 3.markdown` — Forge Blueprint design system tokens (colors, typography, spacing). All custom Tailwind classes must match these values.

### Existing Code to Extend
- `src/pages/MapPage.tsx` — Current MapPage with upload/decomposing/done stages. Phase 2 adds a `'map'` stage and full-screen layout.
- `src/store/appStore.ts` — Zustand store. Needs `selectedNodeId: string | null` slice added for drawer state.

### Prior Phase Research
- `.planning/research/STACK.md` — markmap-lib version (^0.18.12), integration patterns. Read before deciding whether to include markmap-lib at all.
- `.planning/research/PITFALLS.md` — **Critical Pitfall 1**: Do NOT inject React into markmap D3 DOM. This is now moot (we're not using markmap-view), but the pitfall section on event delegation patterns is still informative.
- `.planning/research/ARCHITECTURE.md` — Recommended component boundaries.

### Codebase Maps
- `.planning/codebase/ARCHITECTURE.md` — Component tree and data flow patterns.
- `.planning/codebase/CONCERNS.md` — Known issues (localStorage quota for large trees).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/store/appStore.ts` — Zustand store. The `prdTree: Record<string, PrdNode>` slice is already populated by Phase 1. Add `selectedNodeId` alongside it. Follow the existing `persist` + `partialize` pattern.
- `src/lib/api.ts` — HTTP client pattern. No changes needed for Phase 2 (no new API endpoints required).
- Tailwind design tokens in `tailwind.config.js` — All Forge Blueprint colors already configured (surface, tertiary, secondary, outline-variant, etc.). Use these directly.

### Established Patterns
- State management: Single Zustand selector per value (`useAppStore((s) => s.prdTree)`). Add `selectedNodeId` the same way.
- Component structure: Pages in `src/pages/`, reusable components in `src/components/`.
- CSS: `blueprint-grid` class already defined in `src/index.css`. The map canvas background should reuse it.

### Integration Points
- `src/pages/MapPage.tsx` — Add `stage === 'map'` case and new full-screen layout JSX. The existing `handleReset()` should reset `selectedNodeId` to null and return to `stage === 'upload'`.
- `src/components/upload/TreeSummary.tsx` — Add "查看导图" button that triggers the stage transition to `'map'`.
- `src/App.tsx` (via wouter) — ForgePage at `#/forge/:nodeId` already stub-implemented. No route changes needed.

</code_context>

<specifics>
## Specific Ideas

- The design mockup uses `box-shadow: 0 0 15px -3px rgba(173, 198, 255, 0.2)` for `node-glow` and `0 0 20px -3px rgba(5, 102, 217, 0.4)` for `processing-glow` — replicate these exactly.
- The TopAppBar in the mockup shows: app icon (`account_tree`), app title, a divider, a status chip ("Markmap Ready" / change to "Document Loaded" or similar), and right-side actions (Upload PRD button, settings icon).
- Node cards show: type badge (ROOT NODE / MODULE / feature), title, summary text (2-line clamp), ID badge at bottom, status badge top-right.
- The preview drawer has a `shadow-[-8px_0_24px_rgba(0,0,0,0.5)]` left-shadow to float above the canvas.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-mindmap-preview*
*Context gathered: 2026-05-26*
