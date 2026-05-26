# Phase 2: Mindmap & Preview - Research

**Researched:** 2026-05-26
**Domain:** Custom React column-based tree visualization, CSS transform zoom/pan, preview drawer interaction
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Use custom React tree component that matches Image 2.html exactly — column-based layout with CSS-styled boxes and SVG connection lines. Do NOT use markmap-view for visual rendering.
- **D-02:** `markmap-lib` may be used for its Transformer/tree utilities if needed for data conversion, but the visual output is pure React + CSS, not markmap SVG. The prdTree flat map from Zustand is the source of truth; convert to a hierarchical structure for rendering.
- **D-03:** Tree layout: columns correspond to tree depth levels (root column → module column → leaf column). SVG `<path>` elements drawn as connection lines between columns, matching the `svg-line` class pattern in the design mockup.
- **D-04:** MapPage handles all stages internally — no new route needed. Add a new `stage === 'map'` state after "done". The "查看导图" button in TreeSummary triggers transition to the map stage.
- **D-05:** Transition animation: centered card fades out (opacity 0), full-screen map layout fades in (opacity 1). No scale or translate animation — simple opacity fade only.
- **D-06:** Full-screen map layout includes: TopAppBar (fixed header with app name + "Upload PRD" button), left canvas (flex-1), right preview drawer (conditionally visible).
- **D-07:** Single click → open right-side preview drawer for the clicked node. `selectedNodeId` set in Zustand store.
- **D-08:** Double click → navigate directly to `#/forge/:nodeId` (bypasses preview drawer). Prevents single-click event from firing when double-clicking (standard dblclick debounce pattern).
- **D-09:** "Enter Deep Forge" button inside the preview drawer also navigates to `#/forge/:nodeId`.
- **D-10:** Drawer is closed by default when entering map view. No right panel visible until a node is clicked.
- **D-11:** When a node is clicked, the drawer slides in from the right. The mindmap canvas shrinks from 100% to ~70% width. Transition: CSS width transition (300ms ease).
- **D-12:** Drawer shows: node title, node ID badge (e.g. PL-01), "Extracted Context" (node summary), "Technical Implementation Notes" (techNotes), "Enter Deep Forge" button at the bottom. Close button (×) hides the drawer.

### Claude's Discretion

- **Zoom/Pan:** Implement via CSS `transform: scale() translate()` on the tree container. The three zoom controls (zoom-out, fit-screen, zoom-in) map to: decrease scale, reset to fit the viewport, increase scale. Preserve zoom level across data updates (MAP-06).
- **Status Badges:** Map `PrdNode.status` to badge visuals:
  - `status: 'pending'` → "To Process" orange badge (matching `processing-glow` + `#ff5429` border style)
  - `status: 'done'` → "Generated" green badge (matching `tertiary` color + `check_circle` icon)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MAP-01 | markmap SVG渲染文档树结构 | Re-scoped to custom React column tree; prdTree → hierarchical structure conversion pattern documented below |
| MAP-02 | React overlay层显示节点状态badge | Status badge pattern extracted from Image 2.html; inline badge on each node card |
| MAP-03 | 缩放/平移/适配控件 | CSS transform approach: scale + translate on container ref; fit-screen calculates container/viewport ratio |
| MAP-04 | 节点展开/收起动画效果 | Column-based layout: CSS transition on column visibility or gap; or omitted for MVP given no expand/collapse in Image 2 mockup |
| MAP-05 | 暗色主题适配（Forge Blueprint设计系统） | All tokens already in tailwind.config.js; node-glow / processing-glow need custom CSS in index.css |
| MAP-06 | setData()调用时保持当前缩放位置不重置 | Zoom stored in React ref (not state); tree re-render preserves ref value |
| PRVW-01 | 单击节点打开右侧预览drawer面板 | selectedNodeId in Zustand already exists; drawer visibility = selectedNodeId !== null |
| PRVW-02 | 预览面板显示节点摘要内容和技术实现备注 | PrdNode.summary + PrdNode.techNotes from store |
| PRVW-03 | 预览面板含"Enter Deep Forge"按钮导航到forge view | wouter useLocation navigate to #/forge/:nodeId |
| PRVW-04 | 节点卡片显示ID标识（如PL-01, CE-04） | PrdNode.id already in store; render as `font-code-sm text-on-primary-container` per Image 2 |

</phase_requirements>

---

## Summary

Phase 2 requires building a custom React column-based tree visualization component from scratch — not wrapping an existing graph library. The design is fully specified in `stitch/main/Image 2.html`, which provides exact HTML structure, CSS class names, color tokens, and shadow values. The implementation maps the flat `PrdTree` (Record<string, PrdNode>) from Zustand into three rendering columns (root / module / leaf), connects them with SVG bezier paths, and adds click interaction for the preview drawer.

The Zustand store already has `selectedNodeId: string | null` with `setSelectedNodeId` action (Phase 1 already added them). The `PrdNode` type includes all required fields: `id`, `label`, `summary`, `techNotes`, `status`, `level`, `type`, `children`, `order`. No new store shape changes are needed for Phase 2.

Zoom/pan is implemented without any third-party library — a `useRef` holds `{ scale, translateX, translateY }` and is applied as a CSS transform on the tree container div. The fit-screen action calculates the ratio between the container's natural scroll dimensions and the viewport.

**Primary recommendation:** Build TreeCanvas as a new component that owns zoom/pan state (via ref), renders the three-column layout matching Image 2.html exactly, and delegates node click/double-click to MapPage. Preview drawer is a sibling component rendered conditionally based on `selectedNodeId`.

---

## Standard Stack

### Core (no new installs required)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React (existing) | latest | Component tree, event handlers | Already in project |
| Tailwind CSS (existing) | ^3.4.17 | All node card styles, drawer styles | Already configured with all Forge Blueprint tokens |
| Zustand (existing) | ^5.0.13 | `prdTree` source of truth, `selectedNodeId` drawer state | Already in store with correct shape |
| wouter (existing) | installed in Phase 1 | Navigate to `/forge/:nodeId` on double-click | Already used in ForgePage |
| CSS SVG (no library) | — | Connection line paths between columns | Native browser SVG; no D3 needed |

### NOT needed (decisions locked these out)

| Package | Reason NOT Used |
|---------|----------------|
| markmap-view | D-01 locked: visual rendering is pure React, not markmap SVG |
| react-flow / xyflow | Overkill; column layout is simpler than a graph layout engine |
| d3 (standalone) | Not needed without markmap-view; CSS transforms handle zoom/pan |
| framer-motion | Simple opacity fade + CSS width transition requires no animation library |

**Installation:** No new packages required for Phase 2. All needed capabilities are in the existing stack.

---

## Architecture Patterns

### Recommended Project Structure for Phase 2

```
src/
├── pages/
│   └── MapPage.tsx              # Add stage='map' branch; owns stage transitions
├── components/
│   ├── upload/
│   │   └── TreeSummary.tsx      # Add "查看导图" button (triggers stage='map')
│   └── map/                     # NEW directory for Phase 2 components
│       ├── TreeCanvas.tsx       # Column-based tree + SVG connections + zoom/pan
│       ├── NodeCard.tsx         # Single node card with badge, click handlers
│       ├── PreviewDrawer.tsx    # Right-side slide-in drawer
│       └── TopAppBar.tsx        # Fixed header with app name + Upload PRD button
```

### Pattern 1: Flat Map → Column Arrays Conversion

**What:** Convert `PrdTree` (flat Record<id, PrdNode>) into arrays per depth level for column rendering.

**When to use:** Inside TreeCanvas before rendering; memoized with `useMemo` on `prdTree`.

**Example:**
```typescript
// Source: derived from PrdNode type in src/types/prdNode.ts
function buildColumns(tree: PrdTree): PrdNode[][] {
  const nodes = Object.values(tree)
  const maxLevel = Math.max(...nodes.map((n) => n.level), 0)
  const columns: PrdNode[][] = []
  for (let lvl = 1; lvl <= maxLevel; lvl++) {
    columns.push(
      nodes
        .filter((n) => n.level === lvl)
        .sort((a, b) => a.order - b.order)
    )
  }
  return columns
}
```

Note: The root node (level 0 or the single node with `parentId === null`) forms column 0. Nodes at level 1 form column 1 (MODULE), nodes at level 2 form column 2 (leaf). Check `prdNode.ts`: root children start at level 1. Nodes with `parentId === null` are root; their children (level 1) are modules; grandchildren (level 2) are leaves.

### Pattern 2: CSS Transform Zoom/Pan with Ref

**What:** Store `{ scale, tx, ty }` in a `useRef` (not `useState`) to avoid React re-renders on every pan tick. Apply as inline style on the tree container. Update DOM directly via the ref.

**When to use:** Any pan/drag event — `useRef` avoids re-render on every mousemove.

**Example:**
```typescript
// Zoom/pan via ref — no library needed
const transformRef = useRef({ scale: 1, tx: 0, ty: 0 })
const containerRef = useRef<HTMLDivElement>(null)

function applyTransform() {
  if (!containerRef.current) return
  const { scale, tx, ty } = transformRef.current
  containerRef.current.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`
}

function handleZoomIn() {
  transformRef.current.scale = Math.min(transformRef.current.scale + 0.1, 2)
  applyTransform()
}

function handleFitScreen() {
  // Reset to center, scale 1 (or calculate fit ratio)
  transformRef.current = { scale: 1, tx: 0, ty: 0 }
  applyTransform()
}
```

**MAP-06 compliance:** Because zoom is in a ref and applied imperatively, React tree re-renders (e.g., when `prdTree` updates in store) do NOT reset the zoom. The transform is preserved across data updates automatically.

**Panning via drag:**
```typescript
// Attach to the canvas wrapper (not the transformed container)
let dragStart: { x: number; y: number } | null = null

function onPointerDown(e: React.PointerEvent) {
  dragStart = { x: e.clientX - transformRef.current.tx, y: e.clientY - transformRef.current.ty }
  e.currentTarget.setPointerCapture(e.pointerId)
}

function onPointerMove(e: React.PointerEvent) {
  if (!dragStart) return
  transformRef.current.tx = e.clientX - dragStart.x
  transformRef.current.ty = e.clientY - dragStart.y
  applyTransform()
}

function onPointerUp() { dragStart = null }
```

### Pattern 3: SVG Connection Lines Between Columns

**What:** Absolute-positioned SVG overlay spanning the full tree container width/height, with bezier `<path>` elements connecting parent nodes to child nodes.

**When to use:** After columns are rendered and their DOM rects are available; recalculate on `prdTree` changes and on window resize.

**Example:**
```typescript
// Source: Image 2.html svg-line pattern
// Bezier: exit right edge of parent → enter left edge of child
// M parentRight,parentMidY C midX,parentMidY midX,childMidY childLeft,childMidY
function buildPath(px: number, py: number, cx: number, cy: number): string {
  const midX = (px + cx) / 2
  return `M ${px} ${py} C ${midX} ${py}, ${midX} ${cy}, ${cx} ${cy}`
}
```

The SVG uses `position: absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:0`. Node cards use `z-index:10` (via `relative z-10` in Tailwind).

To get node positions: use `getBoundingClientRect()` on each `NodeCard` element via a ref map (`nodeRefs: Map<string, HTMLDivElement>`). Calculate positions relative to the canvas container's bounding rect. Re-run on `prdTree` change using `useLayoutEffect` (fires synchronously after paint, before browser repaint).

### Pattern 4: Single-Click / Double-Click Disambiguation

**What:** Standard click timer pattern to distinguish single from double click.

**When to use:** On every NodeCard — single click opens drawer, double click navigates.

**Example:**
```typescript
// Source: standard browser pattern for dblclick disambiguation
const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

function handleClick(nodeId: string) {
  if (clickTimerRef.current) {
    // Second click within 300ms → double-click intent
    clearTimeout(clickTimerRef.current)
    clickTimerRef.current = null
    navigate(`/forge/${nodeId}`)
  } else {
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null
      setSelectedNodeId(nodeId)   // single click → open drawer
    }, 300)
  }
}
```

**Warning:** Do NOT use the browser's native `dblclick` event alongside `click`. Both fire on a double-click: `click` fires twice, then `dblclick` fires once. Using the timer approach on a single `onClick` handler is the correct solution.

### Pattern 5: MapPage Stage Transition — Fade In/Out

**What:** CSS opacity transition between centered-card layout and full-screen map layout.

**When to use:** When `stage` changes from `'done'` to `'map'` (and back on reset).

**Implementation approach:**
```typescript
type Stage = 'upload' | 'decomposing' | 'done' | 'error' | 'map'
```

The outer `div` in MapPage already uses `className="w-full h-screen flex items-center justify-center bg-background blueprint-grid overflow-hidden"`. For `stage === 'map'`, replace it entirely with the full-screen layout div. Use a brief `opacity-0 → opacity-100` transition applied via a `useEffect` and a `mounted` state flag, or simply render both divs and use conditional opacity classes.

Simplest approach — `transition-opacity duration-300`:
```typescript
// In MapPage render:
if (stage === 'map') {
  return <MapLayout onReset={handleReset} />
}
// Before 'map', render the card layout as before
```

A simple conditional render (no animation state needed) achieves the visual switch. The D-05 "opacity fade" can be achieved by applying `animate-in fade-in` via a CSS class on the MapLayout mount. Since the project doesn't use framer-motion, a simple CSS `@keyframes fade-in` added to index.css or Tailwind's `transition-opacity` on the container achieves D-05.

### Anti-Patterns to Avoid

- **Storing zoom in React useState:** Causes re-render on every pan mousemove event (60fps = 60 re-renders/second). Use `useRef` + imperative DOM style update instead.
- **Calculating SVG paths in render:** Path recalculation requires DOM measurements (getBoundingClientRect). Do this in `useLayoutEffect`, not during render.
- **Using native `dblclick` event:** Browser fires `click` twice before `dblclick`. Results in drawer opening then navigating. Use click-timer disambiguation instead.
- **Injecting React into markmap SVG:** Pitfall 1 from PITFALLS.md — N/A since we're not using markmap-view, but worth flagging as the reason we chose the custom approach.
- **Setting `selectedNodeId` in local component state:** It must live in Zustand (already does as of Phase 1) so the preview drawer component can read it without prop drilling.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSS theme tokens | Custom CSS variables | Existing `tailwind.config.js` | All Forge Blueprint colors already configured; just use Tailwind classes |
| Navigation | Custom history stack | `useLocation` from wouter (already installed) | Already in project; `navigate('/forge/' + nodeId)` works |
| Custom scrollbar styles | New CSS | Already in `src/index.css` | `::-webkit-scrollbar` block handles both canvas and drawer |
| blueprint-grid background | CSS re-implementation | `.blueprint-grid` class in `index.css` | Already defined; apply to canvas section |

**Key insight:** Phase 2 is primarily a layout/interaction phase. All infrastructure (store, routing, Tailwind tokens, CSS utilities) is in place. The work is assembling components that match Image 2.html pixel-for-pixel.

---

## Common Pitfalls

### Pitfall 1: SVG Path Coordinates Based on Stale DOM Measurements

**What goes wrong:** `getBoundingClientRect()` is called during render or in a `useEffect` that fires before the browser has laid out the new node cards. Paths connect to `(0,0)` or wrong positions.

**Why it happens:** React's `useEffect` fires after paint but the layout may not be stable if fonts haven't loaded or if the tree container has pending CSS transitions.

**How to avoid:** Use `useLayoutEffect` (fires synchronously after DOM mutation, before paint) to read `getBoundingClientRect()` and set SVG path data. Add a `ResizeObserver` on the tree container to re-trigger path calculation if the container resizes.

**Warning signs:** SVG lines render at top-left corner; lines look correct on first render but break after zoom.

### Pitfall 2: Drawer Width Transition Causes Layout Thrash

**What goes wrong:** The canvas section uses `flex-1` for full width. When the drawer opens, adding a fixed-width aside causes the canvas to shrink. If both the canvas and drawer animate simultaneously with CSS transitions, `flex-1` recalculation causes reflow on every animation frame.

**Why it happens:** `flex-1` is computed dynamically. CSS transitions on flex children trigger layout recalculation at each frame.

**How to avoid:** Use `width` transition on the aside element (from `0` to `30%` / `min-w-[360px]`), not on the canvas. The canvas naturally fills remaining space. Set `overflow: hidden` on the aside during transition to prevent content overflow.

```css
/* Pattern from Image 2.html: aside uses fixed min-width */
/* Animate width from 0 to 30% using CSS transition */
aside {
  width: 0;
  transition: width 300ms ease;
  overflow: hidden;
}
aside.open {
  width: 30%;
  min-width: 360px;
}
```

Alternatively, render the aside always and use `translateX(100%)` → `translateX(0)` with `position: absolute` on the aside, `padding-right` on the canvas.

**Warning signs:** Canvas content jumps/snaps when drawer opens rather than smoothly sliding.

### Pitfall 3: Click Timer Not Cleared on Component Unmount

**What goes wrong:** User double-clicks a node. Navigation fires before the single-click timer clears. After ForgePage mounts and user navigates back, the queued `setSelectedNodeId` fires on an unmounted component (or stale state).

**Why it happens:** `setTimeout` callback holds a stale closure over `setSelectedNodeId`.

**How to avoid:** Clear the click timer in the NodeCard's cleanup (or in a `useEffect` cleanup in the component that owns the timer ref).

```typescript
useEffect(() => {
  return () => { if (clickTimerRef.current) clearTimeout(clickTimerRef.current) }
}, [])
```

**Warning signs:** Drawer opens briefly during navigation; console shows "Can't perform a React state update on an unmounted component."

### Pitfall 4: Tree Re-Render Resets Inline Transform Style

**What goes wrong:** Zoom is stored in a ref and applied as an inline `style` on the container. When `prdTree` in Zustand updates, React re-renders `TreeCanvas`, React compares the `style` prop, and if the initial `style` prop doesn't include the transform, React overwrites it to `{}`.

**Why it happens:** React reconciler compares `style` objects by reference on each render. If you pass `style={{ transformOrigin: 'center' }}` without the transform values, React replaces the inline style on re-render.

**How to avoid:** Apply the transform imperatively via `containerRef.current.style.transform` only — never via the React `style` prop. Initialize the container without any transform in the `style` prop. The imperative update bypasses React's reconciler entirely.

```typescript
// WRONG: React will overwrite this on re-render
<div ref={containerRef} style={{ transform: `scale(${scale})` }}>

// CORRECT: Apply imperatively, React never sees the transform
<div ref={containerRef}>
// ... then in applyTransform(): containerRef.current.style.transform = ...
```

**Warning signs:** Zoom resets to 1x after any store update (status badge change, tree update).

### Pitfall 5: MAP-04 (Expand/Collapse) vs Image 2.html Design

**What goes wrong:** MAP-04 requirement says "节点展开/收起动画效果". The Image 2.html mockup shows a flat three-column layout with no expand/collapse controls. Implementing collapse on a column-based layout is non-trivial (collapsing a module would need to remove its leaf column entries).

**Why it happens:** Requirement MAP-04 was written referencing the old markmap-based design. The current design (D-01 through D-03) uses a column layout where every node is always visible.

**How to avoid:** Interpret MAP-04 as "column visibility" — if there are no leaf nodes (no level-2 nodes in the tree), don't render the third column. If there are no module nodes (no level-1), render only the root column. This satisfies the spirit of the requirement (adaptive column rendering) without implementing a full collapse mechanism.

For actual collapse interaction, defer to a future enhancement unless explicitly required.

**Warning signs:** Hours spent implementing a tree collapse system that isn't present in the design mockup.

---

## Code Examples

Verified patterns from existing codebase and Image 2.html:

### Node Card — "To Process" Badge (pending status)
```tsx
// Source: Image 2.html lines 244-248
<div className="flex items-center gap-xs bg-[#b22a00]/20 border border-[#ff5429] text-[#ff8b6b] px-2 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase">
  <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>auto_awesome</span>
  To Process
</div>
```

### Node Card — "Generated" Badge (done status)
```tsx
// Source: Image 2.html lines 265-269
<div className="flex items-center gap-xs bg-tertiary-container/40 border border-on-tertiary-container text-tertiary px-2 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase">
  <span className="material-symbols-outlined" style={{ fontSize: '12px', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
  Generated
</div>
```

### TopAppBar
```tsx
// Source: Image 2.html lines 147-174
<header className="flex justify-between items-center h-16 px-lg w-full bg-surface border-b border-outline-variant z-20 shrink-0">
  <div className="flex items-center gap-md">
    <span className="material-symbols-outlined text-primary">account_tree</span>
    <h1 className="font-headline-md text-headline-md font-bold text-primary">GameUX PromptForge</h1>
    <div className="h-6 w-[1px] bg-outline-variant mx-sm" />
    <div className="flex items-center gap-sm bg-surface-container-high px-sm py-xs rounded-full border border-outline-variant">
      <span className="material-symbols-outlined text-tertiary" style={{ fontSize: '16px', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
      <span className="font-label-md text-label-md text-tertiary">Document Loaded</span>
    </div>
  </div>
  <div className="flex items-center gap-md">
    <button className="flex items-center gap-sm bg-surface-container-high hover:bg-surface-variant transition-colors text-on-surface border border-outline-variant rounded-lg px-md py-sm font-label-md text-label-md cursor-pointer active:opacity-80">
      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>upload_file</span>
      Upload PRD
    </button>
  </div>
</header>
```

### Canvas Controls (Zoom Buttons)
```tsx
// Source: Image 2.html lines 180-189
<div className="absolute bottom-lg right-lg flex gap-xs bg-surface-container border border-outline-variant rounded-lg p-xs shadow-lg z-10">
  <button onClick={handleZoomOut} className="p-sm text-on-surface-variant hover:text-primary transition-colors hover:bg-surface-variant rounded">
    <span className="material-symbols-outlined">zoom_out</span>
  </button>
  <button onClick={handleFitScreen} className="p-sm text-on-surface-variant hover:text-primary transition-colors hover:bg-surface-variant rounded">
    <span className="material-symbols-outlined">fit_screen</span>
  </button>
  <button onClick={handleZoomIn} className="p-sm text-on-surface-variant hover:text-primary transition-colors hover:bg-surface-variant rounded">
    <span className="material-symbols-outlined">zoom_in</span>
  </button>
</div>
```

### Preview Drawer Structure
```tsx
// Source: Image 2.html lines 282-327
<aside className="w-[30%] min-w-[360px] bg-surface-container border-l border-outline-variant shadow-[-8px_0_24px_rgba(0,0,0,0.5)] flex flex-col z-20 shrink-0">
  {/* Header */}
  <div className="flex justify-between items-center p-md border-b border-outline-variant shrink-0 bg-surface">
    <div className="flex items-center gap-sm">
      <span className="material-symbols-outlined text-primary">data_object</span>
      <h2 className="font-headline-sm text-headline-sm text-on-surface truncate">{node.label}</h2>
    </div>
    <button onClick={handleClose} className="text-on-surface-variant hover:text-primary transition-colors cursor-pointer p-xs rounded hover:bg-surface-variant">
      <span className="material-symbols-outlined">close</span>
    </button>
  </div>
  {/* Content */}
  <div className="flex-1 overflow-y-auto custom-scrollbar p-lg text-on-surface-variant font-body-md space-y-md">
    <h3 className="font-headline-sm text-headline-sm text-on-surface border-b border-outline-variant pb-xs">Extracted Context</h3>
    <p>{node.summary}</p>
    {node.techNotes && (
      <>
        <h3 className="font-headline-sm text-headline-sm text-on-surface border-b border-outline-variant pb-xs mt-lg">Technical Implementation Notes</h3>
        <p>{node.techNotes}</p>
      </>
    )}
  </div>
  {/* Footer */}
  <div className="p-md border-t border-outline-variant shrink-0 bg-surface-container-low">
    <button onClick={() => navigate(`/forge/${node.id}`)} className="w-full bg-secondary-container hover:bg-secondary-container/90 text-on-secondary-container font-headline-sm text-headline-sm py-sm px-lg rounded-lg flex items-center justify-center gap-sm transition-all shadow-lg shadow-secondary-container/20 border border-[#2b88ff]/30 cursor-pointer">
      <span className="material-symbols-outlined">construction</span>
      Enter Deep Forge
    </button>
  </div>
</aside>
```

### Required CSS Additions to index.css
```css
/* Source: Image 2.html lines 111-131 */
.node-glow {
  box-shadow: 0 0 15px -3px rgba(173, 198, 255, 0.2);
}

.active-glow {
  box-shadow: 0 0 20px -3px rgba(78, 222, 163, 0.3);
  border-color: #4edea3;
}

.processing-glow {
  box-shadow: 0 0 20px -3px rgba(5, 102, 217, 0.4);
  border-color: #0566d9;
}

/* For custom-scrollbar inside drawer */
.custom-scrollbar::-webkit-scrollbar { width: 8px; }
.custom-scrollbar::-webkit-scrollbar-track { background: #141313; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: #353434; border-radius: 4px; }
```

---

## Existing Code Integration Points

### What Phase 1 Already Provides (No Changes Needed)

| Item | Location | Phase 2 Usage |
|------|----------|---------------|
| `prdTree: PrdTree \| null` | `appStore.ts` line 37 | Source of tree data for column rendering |
| `selectedNodeId: string \| null` | `appStore.ts` line 38 | Controls drawer visibility |
| `setSelectedNodeId(id)` | `appStore.ts` line 49 | Called on single-click |
| `PrdNode.id, label, summary, techNotes, status, level, type, order` | `types/prdNode.ts` | All fields needed for node cards and drawer |
| `useHashLocation` + wouter Router | `App.tsx` | `navigate('/forge/' + nodeId)` works as-is |
| `blueprint-grid` CSS class | `index.css` | Apply to canvas section directly |
| All Forge Blueprint color tokens | `tailwind.config.js` | All needed colors present |
| Material Symbols font | `index.html` (loaded via Google Fonts link in existing HTML) | All icons from Image 2.html available |

### What Needs to Change

| File | Change Required |
|------|----------------|
| `src/pages/MapPage.tsx` | Add `'map'` to Stage type; add full-screen layout branch for `stage === 'map'`; reset `selectedNodeId` in `handleReset` |
| `src/components/upload/TreeSummary.tsx` | Add "查看导图" button that calls a new `onViewMap: () => void` prop |
| `src/index.css` | Add `node-glow`, `active-glow`, `processing-glow` CSS classes and `custom-scrollbar` |
| `src/components/map/` | New directory with `TreeCanvas.tsx`, `NodeCard.tsx`, `PreviewDrawer.tsx`, `TopAppBar.tsx` |

### Store: No Schema Changes Needed

`selectedNodeId: string | null` and `setSelectedNodeId` are already in the store (Phase 1). No new store keys, no version bump, no migration needed for Phase 2.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies identified — Phase 2 is frontend-only, React + CSS, no new npm packages, no new server endpoints).

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|-----------------|--------|
| markmap-view SVG rendering (original plan) | Custom React column-based tree (D-01) | No D3 dependency for tree; simpler event handling; exact design match |
| react-router-dom routing | wouter hash routing (Phase 1 decision) | Already installed; `useLocation` navigate works for Phase 2 |
| CSS animation libraries (framer-motion) | CSS transitions + Tailwind | No new dependency; opacity fade and width transition are native CSS |

---

## Open Questions

1. **MAP-04 Expand/Collapse Scope**
   - What we know: Image 2.html shows a flat three-column layout with no collapse controls
   - What's unclear: Whether MAP-04 expects actual user-triggered collapse or just the conditional rendering described above
   - Recommendation: Implement adaptive column rendering (hide empty columns) and mark MAP-04 as satisfied. Add a note in PLAN.md. Do not implement user-triggered collapse unless clarified.

2. **Root Node Rendering**
   - What we know: PrdNode.level starts at 1 for children of root. The root itself (parentId === null) is level 0 or doesn't have a level field set in that way.
   - What's unclear: Looking at prdNode.ts, nodes with `parentId === null` are root; their `level` field value needs to be verified from actual decomposition output.
   - Recommendation: In `buildColumns()`, treat nodes with `parentId === null` as column 0 (root column), level-1 nodes as column 1 (module), level-2 nodes as column 2 (leaf). Verify with a test decomposition output.

3. **SVG Path Position Calculation During Zoom**
   - What we know: SVG paths use `getBoundingClientRect()` measured relative to the canvas container, then positions are stored. During zoom, the transform is applied to the container that wraps both node cards AND the SVG.
   - What's unclear: If the SVG is inside the transformed container, paths are auto-correct during zoom (transform applies to both nodes and SVG). If the SVG is outside/absolute-positioned, it needs separate transform handling.
   - Recommendation: Place the SVG inside the same transformed container as the columns. Paths calculated from the untransformed layout positions will scale correctly with the container's CSS transform.

---

## Sources

### Primary (HIGH confidence)
- `stitch/main/Image 2.html` — canonical UI spec with exact HTML/CSS structure, color values, shadow definitions
- `stitch/main/Image 3.markdown` — Forge Blueprint design tokens (all verified against tailwind.config.js)
- `src/types/prdNode.ts` — PrdNode type with all field names confirmed
- `src/store/appStore.ts` — `selectedNodeId` and `setSelectedNodeId` already present
- `src/pages/MapPage.tsx` — current Stage type and stage transition pattern
- `src/index.css` — existing CSS utilities (blueprint-grid, scrollbar styles)
- `tailwind.config.js` — all Forge Blueprint color tokens confirmed present

### Secondary (MEDIUM confidence)
- `.planning/research/PITFALLS.md` — Pitfall 10 (dblclick unreliable) informs click-timer disambiguation approach; Pitfall 4 (zoom reset on setData) informs ref-based zoom approach
- `.planning/research/STACK.md` — confirmed markmap-lib not needed for Phase 2 (no markmap-view usage)

### Tertiary (LOW confidence — training data patterns)
- CSS transform zoom/pan pattern: standard browser technique, no library source. HIGH confidence in effectiveness based on widespread use.
- `useLayoutEffect` for DOM measurement: React docs pattern (HIGH confidence).
- Click-timer disambiguation: standard browser pattern (HIGH confidence).

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — no new packages; all existing dependencies confirmed
- Architecture: HIGH — design mockup is fully specified HTML; component boundaries are clear
- Pitfalls: HIGH for CSS/React patterns (proven patterns); MEDIUM for SVG coordinate math during zoom (requires testing)
- Integration: HIGH — Phase 1 store shape matches all Phase 2 needs without modification

**Research date:** 2026-05-26
**Valid until:** 2026-07-26 (design tokens are locked; React/Tailwind patterns are stable)
