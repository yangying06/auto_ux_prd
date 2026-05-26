# Architecture Patterns

**Domain:** Mindmap-based PRD decomposition + per-node AI chat, added to existing React SPA
**Researched:** 2026-05-26

---

## Existing Architecture (Constraint Baseline)

The current app is a no-routing SPA: `App → AppShell → [ChatPanel, StateCanvas]`. State lives in a single Zustand store with localStorage persistence. The Express proxy owns all Claude API calls. This must be preserved and extended, not replaced.

Key constraints that shape everything below:
- No routing currently exists; adding a router must not break the existing Forge view
- The store already persists `messages` and `requirement` under a single key at version 3
- Express body limit is 1 MB — large PRD uploads will need the limit raised server-side
- `AppShell` is the only async orchestrator; the new Map view needs its own equivalent

---

## Recommended Architecture

### View Model: Two Top-Level Views, One Router

Replace the static `AppShell` render in `App.tsx` with a minimal hash router (`wouter` preferred — zero config, 1.3 kB, no file-based routing needed). Two routes:

```
/           → MapView      (mindmap canvas + preview drawer)
/forge/:id  → ForgeView    (per-node AI chat, the existing AppShell)
```

`wouter` uses `useLocation` / `useRoute` hooks and a `<Switch>` component. It does not require a build step change, works with Vite's existing dev server, and is compatible with Tauri's webview (hash routing avoids the need for server-side rewrite rules).

### Component Boundaries

```
App.tsx
├── Router (wouter Switch)
│   ├── Route "/"      → MapView
│   │   ├── MapTopBar            (Upload PRD button, Markmap Ready status)
│   │   ├── MindmapCanvas        (markmap SVG + overlay layer)
│   │   │   ├── markmap-view     (third-party, renders SVG)
│   │   │   └── NodeOverlay      (React layer: status badges, double-click zones)
│   │   └── NodePreviewDrawer    (right panel, node detail + Enter Deep Forge CTA)
│   │
│   └── Route "/forge/:id" → ForgeView
│       └── (existing AppShell, adapted to receive nodeId prop)
│
└── (shared) SettingsPanel (modal, can stay in AppShell or move to App level)
```

**Component responsibilities:**

| Component | Owns | Communicates With |
|-----------|------|-------------------|
| `MapView` | Layout orchestration, upload trigger | `MindmapCanvas`, `NodePreviewDrawer`, store |
| `MapTopBar` | Upload PRD button, parse status badge | `MapView` via callback |
| `MindmapCanvas` | markmap SVG rendering, zoom controls | Store (reads `prdTree`), emits `onNodeClick`, `onNodeDoubleClick` |
| `NodeOverlay` | Status badges rendered over SVG nodes | Store (reads node status map), positioned via markmap node coords |
| `NodePreviewDrawer` | Right-side preview of selected node | Store (reads selected node content), navigates to `/forge/:id` |
| `ForgeView` | Per-node chat orchestration | Existing `AppShell` logic, store (reads/writes node chat slice) |

---

## Data Flow

### 1. PRD Upload and Parse

```
User clicks Upload PRD
  → MapTopBar triggers file input
  → File read as text (not base64) in browser
  → POST /api/parse-prd  { mdText: string }  [new endpoint]
  → server: Claude parses MD into PrdTree JSON
  → store.setPrdTree(tree)
  → MindmapCanvas re-renders with new tree
```

`PrdTree` shape:
```typescript
interface PrdNode {
  id: string           // e.g. "PL-01"
  label: string        // display text
  type: 'root' | 'module' | 'leaf'
  summary: string | null   // brief extracted context
  content: string | null   // full extracted section text
  status: 'unprocessed' | 'in_progress' | 'complete'
  children: PrdNode[]
}

interface PrdTree {
  rootId: string
  nodes: Record<string, PrdNode>   // flat map for O(1) lookup
  rootChildren: string[]            // ordered child IDs of root
}
```

Flat map + ID references is the correct shape here: markmap works with a nested tree for rendering, but the rest of the app (chat histories, status updates, node lookup) needs O(1) access by ID. Transform flat→nested only at the markmap render boundary.

### 2. Mindmap Rendering (markmap integration)

markmap's `markmap-view` package renders from a `INode` tree into a `<svg>` element imperatively. The React integration pattern is:

```typescript
// MindmapCanvas.tsx
const svgRef = useRef<SVGSVGElement>(null)
const mmRef  = useRef<Markmap | null>(null)

useEffect(() => {
  if (!svgRef.current || mmRef.current) return
  mmRef.current = Markmap.create(svgRef.current, options)
}, [])

useEffect(() => {
  if (!mmRef.current || !prdTree) return
  mmRef.current.setData(toMarkmapTree(prdTree))
  mmRef.current.fit()
}, [prdTree])

return <svg ref={svgRef} className="w-full h-full" />
```

`toMarkmapTree()` converts the flat `PrdTree.nodes` into the nested `INode` format markmap expects.

**Custom interaction overlay:** markmap renders SVG `<g>` elements for each node. Clicking the SVG directly to detect node double-click is unreliable (markmap uses D3 click handlers for expand/collapse internally). The documented workaround is to attach a D3 listener to the markmap instance's internal node `<g>` elements after render, or override markmap's click handler via its `options.toggle` config and instead respond to the custom event.

Simpler approach that avoids fighting D3: use markmap for rendering only (visual tree), and render an absolutely-positioned React `<div>` overlay (`NodeOverlay`) that mirrors node positions. On each markmap render/zoom, read node positions from the SVG DOM and sync overlay div positions. This keeps React in control of all interaction.

### 3. Node Selection and Preview

```
User single-clicks node card (in overlay)
  → store.setSelectedNodeId(id)
  → NodePreviewDrawer reads selectedNodeId → shows node.summary, node.content
  → Drawer "Enter Deep Forge" button → navigate('/forge/' + id)
```

### 4. Per-Node Chat (ForgeView)

Each leaf node has its own isolated chat history. The store must be extended:

```typescript
// New slice in appStore:
nodeChats: Record<string, NodeChatState>

interface NodeChatState {
  messages: ChatMessage[]
  requirement: UXRequirementState
  status: 'unprocessed' | 'in_progress' | 'complete'
}
```

`ForgeView` receives `nodeId` from the route param. It reads and writes `nodeChats[nodeId]` instead of the flat `messages` / `requirement` that the current `AppShell` uses.

```
ForgeView mounts with nodeId = "PL-01"
  → reads store.nodeChats["PL-01"] (or initializes empty)
  → existing ChatPanel + StateCanvas render from this slice
  → on chat send: writes back to store.nodeChats["PL-01"]
  → on completion_rate >= threshold: store.markNodeComplete("PL-01")
  → back button → navigate('/')
  → MapView reads updated node status from store.nodes["PL-01"].status
```

The `ChatPanel` and `StateCanvas` components need to be decoupled from the global store (they currently read directly from `useAppStore`). They must accept `messages`, `requirement`, and callbacks as props, OR the store slice path must be parameterized. **Props is simpler and avoids store coupling.**

### 5. Export Flow

When all leaf nodes are `complete`:
```
MapTopBar shows "Export All" button
  → ForgeView (or dedicated handler) iterates store.nodeChats
  → POST /api/export-all  { nodeChatMap: Record<string, NodeChatState> }
  → server generates per-node spec markdown files
  → returns { zipBase64: string } or individual markdown strings
  → download via existing Tauri fs plugin or browser Blob download
```

---

## State Management Design

### Store Extension (additive, no breaking changes)

Current store version is 3. Adding new slices bumps to version 4. The `migrate` function in Zustand persist can upgrade: copy existing `messages` + `requirement` into `nodeChats['legacy']` to preserve any existing work.

```typescript
// New state in appStore
prdTree: PrdTree | null
selectedNodeId: string | null
nodeChats: Record<string, NodeChatState>

// New actions
setPrdTree(tree: PrdTree): void
setSelectedNodeId(id: string | null): void
initNodeChat(nodeId: string): void         // sets empty chat + requirement
updateNodeChat(nodeId: string, patch: Partial<NodeChatState>): void
markNodeComplete(nodeId: string): void
```

`prdTree` and `nodeChats` are both persisted. `prdTree` can be large (for big PRDs) but is text-only — localStorage should handle up to ~5 MB safely.

---

## Server Extensions

Two new endpoints:

```
POST /api/parse-prd
  body: { mdText: string }
  → Claude with a tree-extraction system prompt
  → returns { tree: PrdTree }
  → raise body size limit from 1 MB to 10 MB for this route

POST /api/node-chat
  body: { nodeId, nodeContent, messages, requirementState }
  → same loop as /api/chat but with node-scoped system prompt context
  → returns { reply, statePatch }

POST /api/export-all
  body: { nodeChatMap }
  → returns { files: Array<{ filename, markdown }> }
```

The existing `/api/chat` endpoint stays unchanged for the ForgeView's legacy mode.

---

## Patterns to Follow

### Pattern: Thin Route Components

`MapView` and `ForgeView` are thin orchestrators. They read from the store and pass props to dumb children. No async logic lives inside leaf components.

```typescript
// ForgeView.tsx
export function ForgeView() {
  const { id } = useParams()          // wouter
  const chat = useNodeChat(id)        // custom selector hook
  return (
    <AppShell
      messages={chat.messages}
      requirement={chat.requirement}
      onSend={(msg) => dispatchNodeChat(id, msg)}
      onBack={() => navigate('/')}
    />
  )
}
```

### Pattern: markmap Imperative + React Declarative Split

markmap is imperative (D3-based). React is declarative. Keep them separated:
- markmap renders the SVG in a `useEffect` and is never re-created
- `setData()` is called when the tree changes
- React components never touch the SVG DOM directly
- Node interaction is handled in the React overlay, not inside the D3 render

### Pattern: ID-Keyed Flat Map for Tree State

All tree operations (status lookup, chat history lookup, selection) use the flat `Record<id, PrdNode>` map. The nested tree structure is only reconstructed at the markmap render boundary via `toMarkmapTree()`. This avoids recursive traversals everywhere.

---

## Anti-Patterns to Avoid

### Anti-Pattern: Per-Node Zustand Store Instances
**What it is:** Creating a separate Zustand store per node for chat isolation
**Why bad:** Multiple store instances cause persistence complexity, dev-tools confusion, and no shared selectors
**Instead:** Single store with `Record<nodeId, NodeChatState>` slice

### Anti-Pattern: Putting Chat Logic in MindmapCanvas
**What it is:** Handling node double-click navigation and chat init inside the SVG component
**Why bad:** Mixes rendering concerns with navigation and state initialization
**Instead:** `MindmapCanvas` emits `onNodeDoubleClick(id)`, `MapView` handles the navigation

### Anti-Pattern: Storing Full Markdown Text Inside PrdNode per Message
**What it is:** Duplicating the full PRD section text in every assistant message
**Why bad:** Balloons localStorage fast (each node chat carries its full context repeatedly)
**Instead:** Store `node.content` once in `PrdTree.nodes[id].content`; the server reads it at chat time from the request payload

### Anti-Pattern: React Router DOM with file-system routing
**What it is:** Using React Router v6/v7 with `createBrowserRouter` and loader pattern
**Why bad:** Requires server rewrite rules for deep links, adds significant bundle size, and the app only needs 2 routes
**Instead:** `wouter` with hash mode (`useHashLocation`) — works in Tauri webview without any server config

---

## Suggested Build Order

Dependencies flow top-down; each step unblocks the next:

1. **Router scaffold** (`wouter`, App.tsx switch, two empty route components)
   - Unblocks: all subsequent view work proceeds in the correct shell

2. **Store extension** (new types: `PrdTree`, `NodeChatState`; new slices + actions; bump to v4 with migration)
   - Unblocks: both MapView and ForgeView can read/write state

3. **Server: `/api/parse-prd`** (Claude tree-extraction prompt, raise body limit)
   - Unblocks: MindmapCanvas has real data to render

4. **MindmapCanvas** (markmap-view integration, SVG render, zoom controls, NodeOverlay for status badges)
   - Unblocks: NodePreviewDrawer (needs selected node from canvas interaction)

5. **NodePreviewDrawer** (right panel, reads `selectedNodeId` from store, "Enter Deep Forge" navigation)
   - Unblocks: Full MapView is usable end-to-end

6. **ForgeView** (wraps existing AppShell logic with `nodeId` param; props-ify ChatPanel + StateCanvas)
   - This is the highest-risk step: props-ifying existing components may expose hidden coupling

7. **Server: `/api/node-chat`** (node-scoped chat endpoint with node content injected into system prompt)
   - Can develop in parallel with ForgeView once store is in place

8. **Export all** (`/api/export-all`, zip/multi-file download)
   - Last; requires all nodes to be complete first

---

## Scalability Considerations

| Concern | At 12 nodes (target) | At 50+ nodes |
|---------|----------------------|--------------|
| localStorage size | ~200 KB — fine | ~1 MB — monitor |
| markmap render performance | Instant | Fine; markmap handles 100s of nodes |
| per-node chat history | No issue | No issue (each is small) |
| PRD parse time | ~3-5s Claude call | ~10s for very large docs |

---

## Sources

- Codebase analysis: `src/store/appStore.ts`, `src/types/uxRequirement.ts`, `src/lib/api.ts`, `src/components/layout/AppShell.tsx` (direct read, HIGH confidence)
- Design reference: `stitch/main/Image 1.png`, `stitch/main/Image 2.html` (direct read, HIGH confidence)
- markmap integration pattern: training data on markmap-view D3 internals (MEDIUM confidence — verify exact API against `markmap-view` package docs before implementation; `Markmap.create()`, `setData()`, and `fit()` are the stable surface)
- wouter routing: training data (MEDIUM confidence — verify hash location API `useHashLocation` against current wouter v3 docs)
- Zustand persist migration: training data (HIGH confidence — `migrate` option is stable in Zustand v5)
