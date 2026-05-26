# Domain Pitfalls: PRD Decomposition + Interactive Mindmap with AI

**Domain:** AI-assisted document decomposition, interactive mindmap (markmap), per-node chat sessions
**Project:** GameUX PromptForge — Map milestone
**Researched:** 2026-05-26
**Confidence:** HIGH for pitfalls derived from existing codebase analysis; MEDIUM for markmap-specific patterns (based on library design knowledge + training data, web verification blocked)

---

## Critical Pitfalls

These mistakes cause rewrites, data loss, or a broken core loop.

---

### Pitfall 1: markmap SVG Owns the DOM — React Cannot Manage Node Elements Directly

**What goes wrong:** The plan is to render "custom nodes" inside the markmap (status badges, hover cards). Developers try to inject React-rendered elements (`ReactDOM.render`, portals) into SVG `<text>` or `<foreignObject>` nodes that markmap generates and re-generates during layout. When markmap re-runs layout on data update, it destroys and recreates the SVG node tree, wiping any injected React subtrees.

**Why it happens:** markmap-view uses D3 to build an SVG tree from scratch on every `setData()` / `setOptions()` call. There is no stable identity hook for individual SVG nodes between renders. React's reconciler assumes it owns the DOM subtree it rendered into; D3 assumes it owns the SVG subtree. The two conflict silently.

**Consequences:** Status badges disappear after any AI update or pan/zoom event. Double-click handlers registered on injected elements stop working. React throws "unmounted node" warnings but doesn't crash visibly.

**Prevention:**
- Do NOT inject React-rendered elements inside the markmap SVG.
- Use D3 event delegation instead: attach a single `click` / `dblclick` listener to the SVG container element, identify the clicked node by traversing `event.target` up to the `g.markmap-node` ancestor, extract the node ID from the `data-id` attribute (or D3 datum), then trigger React state changes from there.
- Render status badges as an overlay: an absolutely-positioned React layer on top of the SVG that reads node positions from D3's layout data via `markmapInstance.state.data` and repaints on every `mm.on('data', ...)` event.

**Warning signs:** You find yourself writing `document.querySelector` inside a `useEffect` to find markmap SVG nodes; or you are calling `ReactDOM.createPortal` targeting a D3-managed node.

**Phase:** Map UI phase (markmap integration + custom node styling).

---

### Pitfall 2: AI-Generated Tree JSON Is Structurally Unstable

**What goes wrong:** The prompt asks Claude to decompose a PRD Markdown document into a tree. The response shape varies: sometimes it returns a flat array with `parentId` references, sometimes a nested object, sometimes the `children` key is `nodes` or `items`, and occasionally it wraps the tree in a prose paragraph. The frontend `JSON.parse` passes but the renderer crashes because it expected `{ content: string, children: [] }`.

**Why it happens:** LLMs are probabilistic. Without a strict schema enforced at the prompt + validation layer, every call is a dice roll on property names. The existing `safeParseClaudeJson` in `server/index.ts` (lines 151–169) already demonstrates this problem for the current feature: it has a multi-candidate fallback precisely because Claude sometimes wraps JSON in prose. The decomposition output will be far more complex.

**Consequences:** The decomposition silently produces an empty tree or a single-node tree. The user sees nothing useful and has no way to diagnose why.

**Prevention:**
1. Use Claude's structured output / tool-use API for decomposition. Define a tool `decompose_prd` with an explicit JSON Schema specifying the tree shape. Claude is forced to fill the schema rather than invent its own.
2. Write a `normalizeDecompositionTree(raw)` function (mirroring the existing `normalizeStatePatch` pattern) that validates and coerces the response to a canonical `{ id, content, depth, type, children }` shape before it ever touches the markmap layer.
3. Log and surface parse failures explicitly — never silently return an empty tree. The existing `safeParseClaudeJson` silent-fail pattern is the exact anti-pattern to avoid here.

**Warning signs:** You are writing `raw?.tree ?? raw?.nodes ?? raw?.items ?? []` in the renderer. The tree renders correctly in dev with a small test document but fails with a real 10KB PRD.

**Phase:** AI decomposition phase (Express endpoint + Claude prompt engineering).

---

### Pitfall 3: Per-Node Chat History Stored as a Single Zustand Key

**What goes wrong:** The existing store has a single `messages: ChatMessage[]` array. Developers extend this to per-node histories by storing `nodeMessages: Record<nodeId, ChatMessage[]>` in the same Zustand persist slice. A PRD with 30 nodes, each with 5 turns of multi-block messages, accumulates ~300 messages in localStorage. This hits the existing ~5MB localStorage quota (already flagged in CONCERNS.md for single-session image storage).

**Why it happens:** The single-session model in the existing code is not designed for multiplexed histories. Extending it by adding a Record is the path of least resistance but inherits all its persistence problems at N× scale.

**Consequences:** `localStorage.setItem` throws `QuotaExceededError` (silent in Zustand persist — state is written to memory but not persisted). On reload, ALL node histories are lost. Zustand's version bump without a `migrate` function (already flagged in CONCERNS.md) wipes everything.

**Prevention:**
- Store only the **node IDs and completion status** in Zustand persist. Node chat histories are ephemeral session state — do not persist them in the initial implementation.
- When Tauri FS is available (later phase), write each node's history to a separate JSON file per `nodeId`. This prevents any single write from blocking others.
- In the web phase, if persistence of node histories is required, use IndexedDB (via `idb-keyval`) instead of localStorage. It has no meaningful size limit and supports async writes.
- Implement the `migrate` callback in the Zustand persist config before adding any new keys to the persisted shape.

**Warning signs:** `Object.keys(nodeMessages).length > 10` in a real session; storage quota errors appearing in browser console; users reporting "all my work disappeared after refresh."

**Phase:** Per-node session architecture phase (Zustand store redesign).

---

### Pitfall 4: markmap Re-Renders Reset Pan/Zoom State

**What goes wrong:** The user pans and zooms to a specific area of the mindmap to review a node. The AI finishes generating the decomposition and the app calls `mm.setData(newTree)`. markmap resets the viewport to fit-all. The user's navigation position is lost on every update, including incremental streaming updates.

**Why it happens:** `mm.setData()` triggers a full layout recalculation and calls `mm.fit()` implicitly in some versions. markmap uses D3-zoom internally; its zoom transform is stored in the SVG's `__zoom` D3 datum, not in React state.

**Consequences:** The map is unusable during streaming decomposition updates. Any background state update (e.g., node completion status change) causes a jarring viewport jump.

**Prevention:**
- Separate data updates from viewport. Use `mm.renderData(newTree)` (or the equivalent internal method) to update layout without triggering `fit()`.
- Before any `setData` call, read the current D3 zoom transform: `d3.zoomTransform(svgElement)` and store it in a ref. After the update, restore with `d3.zoom().transform(selection, savedTransform)`.
- Batch state updates: for node-status-only changes (completed/pending), patch the tree data in place rather than calling `setData` with a full new tree object.

**Warning signs:** `mm.setData()` is called from inside a Zustand subscription or a React effect that fires on every AI streaming token.

**Phase:** markmap integration + streaming decomposition.

---

### Pitfall 5: The "Completion Export" Races Node State

**What goes wrong:** The user marks the last node as complete. The export button becomes active. The user clicks export. The export handler reads node states from Zustand and calls the Express `/export` endpoint. But the final node's AI-generated content was not yet fully written back to the store (it is still in a pending `setMessages` call inside the node's chat session), so the exported zip is missing the last node's spec.

**Why it happens:** Node completion is triggered by a user action (confirm button) that fires after the AI response arrives. If the confirm action and the state persistence are async and uncoordinated, there is a window where the export sees a stale completion state.

**Consequences:** The exported spec is incomplete. The user has no indication of the missing content. They discover it when handing the file to a developer.

**Prevention:**
- Model node completion as a two-phase commit: (1) user clicks confirm → `nodeStatus[id] = 'confirming'` → write final spec content → `nodeStatus[id] = 'done'`. The export button only becomes enabled when there are no nodes in `'confirming'` state.
- The export endpoint should receive the full spec content for each node as part of the request payload, not read it from a separate store. The export is a snapshot operation, not a read-through.

**Warning signs:** Export is triggered by watching `allNodesComplete` derived state without checking for any in-flight writes. The export handler queries per-node content from a source that is updated asynchronously.

**Phase:** Export phase.

---

## Moderate Pitfalls

---

### Pitfall 6: Markdown-to-Tree Decomposition Produces Flat or Overly Deep Trees

**What goes wrong:** A PRD document uses inconsistent heading levels (`#`, `##`, sometimes jumping to `####`). The AI decomposition either collapses everything to 2 levels (too flat to be useful) or creates 6-level deep trees that markmap cannot display legibly without extreme zoom-out.

**Prevention:**
- Constrain the AI prompt to produce exactly 3 levels: Module → Feature → Interaction Node. Reject (retry) any tree exceeding 4 levels or containing fewer than 3 nodes total.
- Add a normalization pass: any node at depth > 3 gets promoted to depth 3 and its original parent label is prepended to its content.
- In markmap options, set `initialExpandLevel: 2` so the map opens at a readable zoom before the user drills in.

**Phase:** AI decomposition phase.

---

### Pitfall 7: `express.json` Body Limit Blocks PRD Upload

**What goes wrong:** This is already documented in CONCERNS.md but has a new dimension for the Map milestone. A PRD Markdown document can be 20–100KB of plain text. The current 1MB limit seems sufficient, but if the upload request also includes the existing conversation history (which it does in the current architecture — the full `messages` array is posted on every turn), a 50KB PRD plus a long conversation can approach or exceed 1MB.

**Prevention:**
- Fix the body limit to `'10mb'` as noted in CONCERNS.md before building the decomposition endpoint.
- For the decomposition endpoint specifically, do not include the conversation history in the request. Only send the raw Markdown content and the current session ID.

**Phase:** Express endpoint phase (first thing, before decomposition logic).

---

### Pitfall 8: Zustand Version Bump Without Migration Wipes All Node States

**What goes wrong:** The Map milestone adds new keys to the persisted Zustand shape (`mapNodes`, `nodeStatuses`, `activeNodeId`). The developer bumps `STORAGE_VERSION` from 3 to 4 without adding a `migrate` function. Any existing user data (requirement state, settings) is silently discarded on reload.

**Prevention:**
- Before adding new persisted keys, add a `migrate` function to the Zustand persist config that handles the version 3 → 4 transition by carrying forward existing `requirement` and `settings` values.
- Pattern from the existing code: `STORAGE_VERSION = 3` in `src/store/appStore.ts` line 21 — bump to 4 with a migrate guard.

**Phase:** Zustand store extension phase.

---

### Pitfall 9: markmap Theming Conflicts with Forge Blueprint Dark Theme

**What goes wrong:** markmap ships with its own CSS file (`markmap-view/dist/browser.css`) that sets node colors, link colors, and font families. These defaults use light-theme colors (white backgrounds, dark text) that are invisible or ugly against the Forge Blueprint dark surface (`#141313`).

**Prevention:**
- Do NOT import markmap's default CSS. Use only `markmap-view`'s programmatic API (JavaScript options object) to set colors via `options.color` and `options.style`.
- Override the SVG background and line stroke directly via Tailwind classes applied to the container `<div>`.
- Test on the actual dark background early (Phase 1 of the milestone, not Phase 3).

**Warning signs:** The markmap renders with white node backgrounds; link lines are invisible.

**Phase:** markmap integration phase.

---

### Pitfall 10: Double-Click vs Single-Click Ambiguity on Touch/Trackpad

**What goes wrong:** The design requires double-click to open a node's forge panel. markmap uses click for expand/collapse. On a trackpad, double-tap is frequently misinterpreted as two single clicks (expand then collapse), never triggering the `dblclick` event. The node flickers but never opens the forge panel.

**Prevention:**
- Use `pointerup` with a timing check instead of `dblclick`. Register a `pointerup` listener on the SVG container. If two `pointerup` events fire on the same node within 300ms, treat it as a double-tap.
- Alternatively, use a long-press (300ms `pointerdown` without `pointermove`) for opening the forge panel, and reserve double-click only for desktop/mouse.
- Decide early (Phase 1) — changing the interaction model after the forge panel routing is wired is expensive.

**Phase:** Node interaction event handling.

---

## Minor Pitfalls

---

### Pitfall 11: Stale Closure in Auto-Trigger Effects

**What goes wrong:** This pattern already exists in `AppShell.tsx` (lines 31–38) where `handleGeneratePrototype` is captured as a stale closure. The Map milestone will add similar auto-trigger logic: "when decomposition finishes, auto-fit the map." The same eslint-disable-next-line suppress pattern will produce a stale `proxyBaseUrl` reference.

**Prevention:** Replace stale-closure useEffects with refs for the handler: `const handleRef = useRef(handler); useEffect(() => { handleRef.current = handler; })` and call `handleRef.current()` inside the effect. Or use `useCallback` with correct dependencies.

**Phase:** Any phase that adds auto-trigger effects.

---

### Pitfall 12: Node IDs Must Be Stable Across Re-Decompositions

**What goes wrong:** The AI generates IDs like `node_1`, `node_2` in the first decomposition. The user edits the PRD and re-decomposes. The AI generates `node_1` for a different node. All saved per-node chat histories are now associated with the wrong nodes.

**Prevention:**
- Use content-hash IDs (e.g., `sha1(nodeContent).slice(0, 8)`), not sequential integers. Same content → same ID across re-runs.
- For re-decomposition, do a diff: nodes with matching IDs carry their histories forward; new nodes start fresh; removed node IDs are archived, not deleted.

**Phase:** AI decomposition phase + node ID design.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|---|---|---|
| markmap React integration | Pitfall 1: React/D3 DOM conflict | Use overlay pattern + D3 event delegation from day 1 |
| Claude decomposition prompt | Pitfall 2: Unstable JSON schema | Use tool-use API + normalizeDecompositionTree() |
| Zustand store extension | Pitfall 3: localStorage quota at N×messages | No per-node message persistence in web phase |
| markmap setData on updates | Pitfall 4: Viewport reset | Save/restore D3 zoom transform around every setData call |
| Export trigger | Pitfall 5: Race condition on final node | Two-phase commit for node completion state |
| Express endpoint setup | Pitfall 7: 1MB body limit | Fix limit before writing decomposition endpoint |
| Zustand version bump | Pitfall 8: Silent wipe without migrate | Write migrate() before bumping STORAGE_VERSION |
| Dark theme | Pitfall 9: markmap CSS conflicts | Skip default markmap CSS, use programmatic options only |
| Node interaction | Pitfall 10: dblclick unreliable on trackpad | Use timed pointerup pattern instead |
| Any auto-trigger effect | Pitfall 11: Stale closure | Use ref-based handler pattern |
| Re-decomposition | Pitfall 12: ID collision | Content-hash IDs + diff on re-decompose |

---

## Sources

- Direct codebase analysis: `server/index.ts` (safeParseClaudeJson pattern, body limit), `src/store/appStore.ts` (STORAGE_VERSION, partialize, messages persistence), `src/components/layout/AppShell.tsx` (stale closure pattern)
- `.planning/codebase/CONCERNS.md` — known issues: localStorage quota, 1MB body limit, session management absence, Zustand migration gap
- `.planning/PROJECT.md` — confirmed requirements: markmap custom nodes, per-node chat history, node completion flow, zip export
- markmap library design knowledge (training data, confidence MEDIUM): D3 SVG ownership model, `setData` behavior, CSS defaults
- General LLM output instability patterns (HIGH confidence from existing codebase evidence in `safeParseClaudeJson`)
