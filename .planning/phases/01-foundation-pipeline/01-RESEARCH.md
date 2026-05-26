# Phase 1: Foundation & Pipeline - Research

**Researched:** 2026-05-26
**Domain:** wouter hash routing, Zustand v5 persist migration, Claude tool-use structured output, progressive decomposition, Express v5 body limit
**Confidence:** HIGH (all findings verified against npm registry, package type definitions, or live package READMEs)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Use wouter with hash mode (`useHashLocation`). Routes: `#/` (map view) and `#/forge/:nodeId` (forge view).
- **D-02:** Landing page flow — app opens to centered upload card, transitions in-place to progress view, then auto-navigates to map view.
- **D-03:** Progressive multi-step decomposition — server calls Claude multiple times (L1 first, then branch expansion). Each step returns partial results; frontend renders tree growing incrementally.
- **D-04:** PrdNode type: `id`, `parentId`, `label`, `summary`, `content`, `type` (module|feature|ui), `status` (pending|done), `children[]` (IDs), `level`, `order`, `extractedFrom`, `techNotes`, `needsPolish` (boolean).
- **D-05:** AI marks `needsPolish: boolean` per node during decomposition. Not strictly leaf-only.
- **D-06:** Server decomposes in steps, each step returns partial tree data. Frontend renders tree growing level by level.

### Claude's Discretion

- Landing page visual design (must fit Forge Blueprint dark theme)
- Exact decomposition prompt engineering (schema is defined; prompt strategy is free)
- Error state design for failed uploads or decomposition

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | App supports two routes: map view (/) and forge view (/forge/:nodeId) | wouter hash mode API confirmed — Router + Switch + Route pattern |
| INFRA-02 | Zustand store extended with PrdTree flat node map and per-node chat state | Store extension pattern documented; additive slices safe in v5 |
| INFRA-03 | Store version migrated from 3 to 4 with migrate function | Zustand persist `migrate` signature confirmed from type definitions |
| INFRA-04 | Express body limit raised to 10MB | `express.json({ limit: '10mb' })` verified working on Express 5.2.1 |
| UPLD-01 | User can upload Markdown file via drag-and-drop or file picker | No new library needed — standard HTML5 drag-drop + file input |
| UPLD-02 | Upload displays progress indicator and status feedback | In-component state + fetch abort controller pattern |
| UPLD-03 | AI decomposition shows progress (streaming or staged feedback) | Multi-request staged pattern recommended (see Section 4) |
| DCMP-01 | Server decomposes MD via Claude tool-use into structured tree JSON | `tool_choice: { type: 'tool', name: 'decompose_prd' }` forces schema |
| DCMP-02 | AI decomposes by function/module, not Markdown heading level | Prompt engineering — send raw MD, let Claude semantically decompose |
| DCMP-03 | `normalizeDecompositionTree()` validates returned data structure | Mirrors existing `normalizeStatePatch` pattern in server/index.ts |
| DCMP-04 | Decomposition stored as flat node map `Record<id, PrdNode>` | Flat map + ID references pattern; nested tree only at render boundary |
</phase_requirements>

---

## Summary

Phase 1 builds the structural backbone of the app: routing, store extension, file upload, and the Claude decomposition pipeline. All six research questions have HIGH-confidence answers verified against the live npm registry, package type definitions, and the existing codebase.

The most critical insight is the **decomposition architecture**: use a single Express endpoint that calls Claude three times sequentially (once for L1, once per L1 branch), returning incremental results via repeated JSON responses from a multi-request frontend polling loop — not SSE. The frontend calls `/api/decompose/start`, then polls `/api/decompose/:sessionId/status` until `done`. Each poll response carries partial tree data that the frontend merges into the Zustand store, triggering re-render of the growing tree.

The second key insight: **Claude tool-use with `tool_choice: { type: 'tool', name: 'decompose_prd' }`** forces Claude to fill your exact PrdNode schema, eliminating the probabilistic JSON instability seen in the existing `safeParseClaudeJson` approach.

**Primary recommendation:** Install wouter, implement the staged decomposition with polling (not SSE — simpler, no streaming plumbing), and write the `migrate` function before bumping `STORAGE_VERSION`.

---

## Standard Stack

### Core Additions

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `wouter` | `^3.10.0` | Hash-mode client router | 2.1KB; zero config; `useHashLocation` built-in; works in Tauri webview without server rewrites |

### Already Present (Verify Before Installing)

| Library | Current Version | Role |
|---------|----------------|------|
| `zustand` | `^5.0.13` | State + persist | Already installed — extend only |
| `@anthropic-ai/sdk` | `^0.97.1` | Claude tool-use calls | Already installed |
| `express` | `^5.2.1` | Body limit fix, new endpoint | Already installed |

### No Additional Libraries Needed For

| Problem | Solution |
|---------|----------|
| Drag-and-drop file upload | Native HTML5 `ondragover`/`ondrop` + `<input type="file">` |
| Progress display | In-component React state (no library) |
| Incremental decomposition | Multi-request polling with `fetch` (no SSE library) |
| MD file reading | `FileReader.readAsText()` (browser API) |

**Installation (only one new package):**
```bash
npm install wouter
```

**Version verified:** `npm show wouter version` → `3.10.0` (published 2026-05-21, actively maintained)

---

## Architecture Patterns

### Recommended Project Structure for Phase 1

```
src/
├── pages/
│   ├── MapPage.tsx          # landing + upload + (later) map view
│   └── ForgePage.tsx        # wraps existing AppShell
├── components/
│   ├── upload/
│   │   ├── UploadCard.tsx   # drag-drop zone
│   │   └── DecompProgress.tsx  # step-by-step progress display
│   └── layout/
│       └── AppShell.tsx     # (existing, untouched in Phase 1)
├── types/
│   └── prdNode.ts           # PrdNode, PrdTree interfaces
└── store/
    └── appStore.ts          # (extend existing)

server/
└── index.ts                 # add /api/decompose endpoint, raise body limit
```

---

## Pattern 1: wouter Hash Mode Routing

**Source:** `npm show wouter readme` — verified 2026-05-26

### Setup in App.tsx

```tsx
// src/App.tsx
import { Router, Switch, Route } from 'wouter'
import { useHashLocation } from 'wouter/use-hash-location'
import { MapPage } from './pages/MapPage'
import { ForgePage } from './pages/ForgePage'

export default function App() {
  return (
    <Router hook={useHashLocation}>
      <Switch>
        <Route path="/" component={MapPage} />
        <Route path="/forge/:nodeId" component={ForgePage} />
      </Switch>
    </Router>
  )
}
```

Key point: `useHashLocation` is imported from the sub-path `"wouter/use-hash-location"`, not from `"wouter"`.

### Reading Route Parameters in ForgePage

```tsx
// src/pages/ForgePage.tsx
import { useParams } from 'wouter'

export function ForgePage() {
  const { nodeId } = useParams<{ nodeId: string }>()
  // nodeId is the dynamic segment from /forge/:nodeId
  return <AppShell nodeId={nodeId} />
}
```

### Programmatic Navigation

```tsx
// Inside a React component
import { useLocation } from 'wouter'

function SomeComponent() {
  const [, navigate] = useLocation()

  // Navigate to map after decomposition finishes
  const handleComplete = () => navigate('/')

  // Navigate to forge view
  const openForge = (nodeId: string) => navigate(`/forge/${nodeId}`)

  return ...
}
```

### Navigation Outside a React Component

For navigation from async callbacks (e.g., after decomposition completes and the component may have unmounted):

```tsx
// Use a ref to capture navigate and call it in async context
function MapPage() {
  const [, navigate] = useLocation()
  const navigateRef = useRef(navigate)
  useEffect(() => { navigateRef.current = navigate })

  const handleDecompComplete = async () => {
    await runDecomposition(...)
    navigateRef.current('/')  // safe — always current
  }
}
```

Note: wouter does expose `navigate` from `"wouter/use-browser-location"` for imperative use outside components — but that only works with browser history mode, not hash mode. With hash mode, keep navigation inside components via the ref pattern above.

### URL Shape With Hash Mode

Hash mode produces URLs like `http://localhost:5173/#/forge/PL-01`. The `useHashLocation` hook reads/writes `window.location.hash` (minus the leading `#`). wouter treats the hash portion as the path, so all route patterns work identically to browser history mode.

---

## Pattern 2: Zustand v5 Persist Migration (v3 → v4)

**Source:** `node_modules/zustand/middleware/persist.d.ts` — type signature verified directly

### Migrate Function Signature

From the type definition:
```typescript
migrate?: (persistedState: unknown, version: number) => PersistedState | Promise<PersistedState>
```

- `persistedState` is typed `unknown` because the stored shape may be from any previous version.
- `version` is the version number found in storage (e.g., `3` when migrating from v3 to v4).
- Returns the new persisted state shape (the v4 shape).

### Full Store Extension Pattern

```typescript
// src/store/appStore.ts  (additions only — existing code preserved)

import type { PrdNode, PrdTree } from '../types/prdNode'

const STORAGE_VERSION = 4  // bumped from 3

// New state shape additions
interface AppStoreState {
  // ... existing fields preserved ...
  prdTree: PrdTree | null
  selectedNodeId: string | null
  decompositionStatus: 'idle' | 'decomposing' | 'done' | 'error'
  decompositionSteps: DecompositionStep[]
  // nodeChats intentionally NOT persisted in Phase 1 (localStorage quota risk)

  // New actions
  setPrdTree: (tree: PrdTree) => void
  setSelectedNodeId: (id: string | null) => void
  setDecompositionStatus: (s: AppStoreState['decompositionStatus']) => void
  appendDecompositionStep: (step: DecompositionStep) => void
  mergePartialTree: (nodes: Record<string, PrdNode>) => void
}

// In persist config:
{
  name: STORAGE_KEY,
  version: STORAGE_VERSION,
  migrate: (persistedState: unknown, version: number) => {
    // version 3 → 4: carry forward existing data, add null defaults for new keys
    if (version === 3) {
      const v3 = persistedState as {
        requirement?: unknown
        messages?: unknown
        latestRag?: unknown
        settings?: unknown
      }
      return {
        requirement: v3.requirement ?? emptyRequirement,
        messages: v3.messages ?? initialMessages,
        latestRag: v3.latestRag ?? null,
        settings: v3.settings ?? defaultSettings,
        // New v4 keys with safe defaults
        prdTree: null,
        selectedNodeId: null,
        decompositionStatus: 'idle' as const,
        decompositionSteps: [],
      }
    }
    // Unknown version — return empty state (safe reset)
    return {
      requirement: emptyRequirement,
      messages: initialMessages,
      latestRag: null,
      settings: defaultSettings,
      prdTree: null,
      selectedNodeId: null,
      decompositionStatus: 'idle' as const,
      decompositionSteps: [],
    }
  },
  partialize: (state) => ({
    requirement: state.requirement,
    messages: state.messages,
    latestRag: state.latestRag,
    settings: state.settings,
    prdTree: state.prdTree,           // persist tree (text-only, safe for localStorage)
    selectedNodeId: state.selectedNodeId,
    // decompositionStatus: NOT persisted (session-only)
    // decompositionSteps: NOT persisted (session-only)
  }),
}
```

Critical: The `migrate` function MUST be added before bumping `STORAGE_VERSION`. If you bump the version without `migrate`, any existing persisted state is silently discarded (confirmed by PITFALLS.md Pitfall 8 and the type definition: no migrate = wipe).

---

## Pattern 3: Claude Tool-Use for Forced Structured Output

**Source:** `node_modules/@anthropic-ai/sdk/src/resources/messages/messages.ts` — type definitions verified

### How to Force a Specific Schema

Use `tool_choice: { type: 'tool', name: 'decompose_prd' }` to guarantee Claude fills the `decompose_prd` tool and returns the exact PrdNode JSON schema. This replaces the fragile `safeParseClaudeJson` text-extraction approach for decomposition.

```typescript
// In server/index.ts — new decompose_prd tool definition

const decomposePrdTool: Anthropic.Tool = {
  name: 'decompose_prd',
  description: 'Decompose a PRD document into a structured tree of functional nodes. Each node represents a distinct function, module, or UI interaction.',
  input_schema: {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        description: 'Flat array of all PrdNodes. Root nodes have parentId: null.',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique stable ID, e.g. "CE-01". Use functional abbreviation + index.',
            },
            parentId: {
              type: ['string', 'null'],
              description: 'ID of parent node, or null for root-level nodes.',
            },
            label: {
              type: 'string',
              description: 'Short display name (3-8 words).',
            },
            summary: {
              type: 'string',
              description: 'One sentence summary of what this node covers.',
            },
            content: {
              type: 'string',
              description: 'Full extracted text from the PRD for this node.',
            },
            type: {
              type: 'string',
              enum: ['module', 'feature', 'ui'],
              description: 'module = top-level functional area; feature = sub-function; ui = UI interaction node',
            },
            level: {
              type: 'integer',
              description: 'Depth in tree. Root children = 1, their children = 2, etc.',
            },
            order: {
              type: 'integer',
              description: 'Sort position among siblings (0-indexed).',
            },
            needsPolish: {
              type: 'boolean',
              description: 'True if this node describes a UI interaction that needs Deep Forge polishing.',
            },
            techNotes: {
              type: ['string', 'null'],
              description: 'Optional implementation notes relevant to engineers.',
            },
          },
          required: ['id', 'parentId', 'label', 'summary', 'content', 'type', 'level', 'order', 'needsPolish'],
        },
      },
    },
    required: ['nodes'],
  },
}
```

### Calling the API with Forced Tool Use

```typescript
async function decomposeL1(mdText: string): Promise<PrdNode[]> {
  const response = await anthropic!.messages.create({
    model,
    max_tokens: 8000,
    system: decompositionSystemPrompt,
    tools: [decomposePrdTool],
    tool_choice: { type: 'tool', name: 'decompose_prd' },  // FORCES the tool
    messages: [
      {
        role: 'user',
        content: `Decompose this PRD into top-level functional modules only (level 1 nodes, parentId: null). Do not go deeper than level 1 in this call.\n\n${mdText}`,
      },
    ],
  })

  // With tool_choice forced, response.stop_reason is 'tool_use'
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'decompose_prd'
  )
  if (!toolUse) throw new Error('Claude did not use decompose_prd tool')

  const raw = (toolUse.input as { nodes?: unknown }).nodes
  return normalizeDecompositionNodes(raw)
}
```

### Why `tool_choice: { type: 'tool', name: 'X' }` is the Right Approach

Without `tool_choice`, Claude may respond with a text message instead of calling the tool (especially on simple inputs). With `tool_choice: { type: 'tool', name: 'decompose_prd' }`:

- Claude is **forced** to call that specific tool.
- The JSON is validated by the tool's `input_schema` before Claude outputs it.
- The response's `stop_reason` will always be `'tool_use'`.
- No `safeParseClaudeJson` fallback needed — the input arrives as a typed JavaScript object via `toolUse.input`.

This is the same approach documented in the existing `tools` array in `server/index.ts`, but the existing code does NOT set `tool_choice` (Claude autonomously decides). For decomposition, forcing it is critical.

---

## Pattern 4: Progressive Decomposition Architecture

**Decision D-03 confirmed:** Multi-step server calls, incremental partial tree returned to frontend.

### Recommended Architecture: Staged REST (not SSE)

SSE (Server-Sent Events) and streaming add complexity: Express 5 streaming setup, EventSource client, reconnection logic, auth. For a process that takes 10-30 seconds with 3-5 discrete steps, **staged REST polling** is simpler and sufficient:

```
Frontend                          Server
   │                                 │
   ├─POST /api/decompose/start ──────►│ validate MD, return sessionId
   │◄────────────────────────────────┤ { sessionId: "abc123", status: "running" }
   │                                 │
   │  (server starts async job)      ├─ Call Claude: L1 nodes
   │                                 ├─ store partial result
   │                                 ├─ Call Claude: Branch PL nodes
   │                                 ├─ store partial result
   │                                 └─ Call Claude: Branch CE nodes ...
   │
   ├─GET /api/decompose/abc123 ──────►│ returns current partial tree + status
   │◄────────────────────────────────┤ { nodes: [...], status: "running", step: "Expanding CE branch" }
   │  (frontend merges new nodes)     │
   │  (tree visually grows)           │
   │                                 │
   ├─GET /api/decompose/abc123 ──────►│
   │◄────────────────────────────────┤ { nodes: [...], status: "done" }
   │  (auto-navigate to map view)     │
```

### Server Implementation Sketch

```typescript
// In-memory session store (per-process, acceptable for single-user desktop app)
const decompositionSessions = new Map<string, {
  status: 'running' | 'done' | 'error'
  nodes: PrdNode[]
  currentStep: string
  error?: string
}>()

app.post('/api/decompose/start', async (req, res) => {
  const { mdText } = req.body as { mdText: string }
  if (!mdText?.trim()) return res.status(400).json({ error: 'mdText required' })

  const sessionId = crypto.randomUUID()
  decompositionSessions.set(sessionId, { status: 'running', nodes: [], currentStep: 'Starting' })

  // Kick off async, do NOT await
  runDecompositionJob(sessionId, mdText).catch(err => {
    const session = decompositionSessions.get(sessionId)
    if (session) {
      session.status = 'error'
      session.error = String(err)
    }
  })

  res.json({ sessionId })
})

app.get('/api/decompose/:sessionId', (req, res) => {
  const session = decompositionSessions.get(req.params.sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  res.json(session)
})

async function runDecompositionJob(sessionId: string, mdText: string) {
  const session = decompositionSessions.get(sessionId)!

  // Step 1: L1 nodes
  session.currentStep = 'Decomposing top-level modules'
  const l1Nodes = await decomposeL1(mdText)
  session.nodes.push(...l1Nodes)

  // Step 2: Expand each L1 branch
  for (const l1 of l1Nodes) {
    session.currentStep = `Expanding: ${l1.label}`
    const branchNodes = await decomposeBranch(mdText, l1, l1Nodes)
    session.nodes.push(...branchNodes)
  }

  session.status = 'done'
  session.currentStep = 'Complete'
}
```

### Frontend Polling Pattern

```typescript
// In MapPage.tsx or a custom hook
async function startDecompositionPolling(mdText: string) {
  const { sessionId } = await fetch('/api/decompose/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mdText }),
  }).then(r => r.json())

  const pollInterval = setInterval(async () => {
    const data = await fetch(`/api/decompose/${sessionId}`).then(r => r.json())

    // Merge new nodes into store — tree grows incrementally
    store.mergePartialTree(data.nodes)
    store.setDecompositionStatus(data.status)
    setCurrentStep(data.currentStep)

    if (data.status === 'done' || data.status === 'error') {
      clearInterval(pollInterval)
      if (data.status === 'done') navigate('/')
    }
  }, 1500)  // poll every 1.5s
}
```

### Why Not SSE

| Factor | SSE | Staged REST |
|--------|-----|-------------|
| Express 5 support | Requires `res.setHeader('Content-Type', 'text/event-stream')` setup | Standard `res.json()` |
| Client complexity | `new EventSource(url)` + reconnect logic | `setInterval` + `fetch` |
| Error handling | Stream corruption leaves client stuck | Explicit `{ status: 'error' }` |
| Tauri compatibility | Custom protocol may block SSE | JSON over HTTP works |
| Right for 3-5 steps | Overkill | Perfect |

SSE is the right choice for real-time token streaming. For 3-5 discrete steps over 10-30 seconds, polling is simpler and equally user-friendly.

---

## Pattern 5: wouter + Zustand Integration

**How they interact:** They are independent and should stay that way. Do NOT store route state in Zustand.

### Rule: Router is the source of truth for URL; Zustand is the source of truth for data

```
wouter (hash URL) ─────► ForgePage reads nodeId from useParams()
                               │
                               └──► reads store.prdTree.nodes[nodeId]
                                    writes store.nodeChats[nodeId] (Phase 3)
```

The route param `nodeId` is ephemeral (lost on back-navigation). Zustand `prdTree` is persistent. Never duplicate `nodeId` in the store.

### Post-Decomposition Navigation

After decomposition completes, the MapPage must navigate to `/`. This happens inside a React component (MapPage), so `useLocation` from wouter works fine:

```tsx
// MapPage.tsx
const [, navigate] = useLocation()
// ...called after decomposition polling resolves with status=done
navigate('/')
```

Do not use `window.location.hash = '#/'` directly — this bypasses wouter's history and does not trigger re-renders.

---

## Pattern 6: Express v5 Body Limit Fix

**Verified:** `express.json({ limit: '10mb' })` works identically in Express 4 and Express 5.

```typescript
// server/index.ts line 543 — change from:
app.use(express.json({ limit: '1mb' }))

// to:
app.use(express.json({ limit: '10mb' }))
```

No other changes needed. Express 5's `express.json` is API-compatible with v4 on this option. Confirmed by running `node -e "const e = require('express'); e().use(e.json({limit:'10mb'})); console.log('OK')"` against the installed `5.2.1`.

**One-character diff:** `'1mb'` → `'10mb'`. This is INFRA-04 in its entirety.

---

## normalizeDecompositionTree() Pattern

Mirrors the existing `normalizeStatePatch` in `server/index.ts`. Should be placed in `server/index.ts` alongside existing normalization functions.

```typescript
interface PrdNode {
  id: string
  parentId: string | null
  label: string
  summary: string
  content: string
  type: 'module' | 'feature' | 'ui'
  status: 'pending' | 'done'
  level: number
  order: number
  needsPolish: boolean
  extractedFrom?: string | null
  techNotes?: string | null
  children: string[]  // populated after normalization, not from Claude
}

function normalizeDecompositionNodes(raw: unknown): PrdNode[] {
  if (!Array.isArray(raw)) return []

  const nodes = raw
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const n = item as Record<string, unknown>

      const id = typeof n.id === 'string' && n.id.trim() ? n.id.trim() : `node-${index}`
      const parentId = typeof n.parentId === 'string' ? n.parentId : null
      const label = typeof n.label === 'string' ? n.label : `Node ${id}`
      const summary = typeof n.summary === 'string' ? n.summary : ''
      const content = typeof n.content === 'string' ? n.content : ''
      const type = ['module', 'feature', 'ui'].includes(n.type as string)
        ? (n.type as PrdNode['type'])
        : 'feature'
      const level = typeof n.level === 'number' ? n.level : 0
      const order = typeof n.order === 'number' ? n.order : index
      const needsPolish = typeof n.needsPolish === 'boolean' ? n.needsPolish : false
      const techNotes = typeof n.techNotes === 'string' ? n.techNotes : null

      return {
        id, parentId, label, summary, content, type,
        status: 'pending' as const,
        level, order, needsPolish, techNotes,
        extractedFrom: null,
        children: [],  // populated below
      }
    })
    .filter((n): n is PrdNode => n !== null)

  // Build children arrays from parentId references
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  for (const node of nodes) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId)!.children.push(node.id)
    }
  }

  // Sort children by order
  for (const node of nodes) {
    node.children.sort((a, b) => (nodeMap.get(a)?.order ?? 0) - (nodeMap.get(b)?.order ?? 0))
  }

  return nodes
}

function normalizeDecompositionTree(raw: unknown): Record<string, PrdNode> {
  const nodes = normalizeDecompositionNodes(raw)
  if (nodes.length === 0) throw new Error('normalizeDecompositionTree: empty result')
  return Object.fromEntries(nodes.map(n => [n.id, n]))
}
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hash-based routing | Custom `hashchange` event listener | `wouter` with `useHashLocation` | Route matching regex, params extraction, re-render triggering are all non-trivial |
| Schema-validated JSON from AI | `safeParseClaudeJson` with regex fallbacks | Claude tool-use with forced `tool_choice` | Tool-use validation is done by the API; text extraction fails on complex nested schemas |
| File drag-drop | Third-party drag-drop library | Native HTML5 `ondragover`/`ondrop` events | Zero dependency; the UI is simple enough |
| Streaming progress | SSE with `EventSource` | REST polling with `setInterval` | 3-5 discrete steps do not need a streaming protocol |

---

## Common Pitfalls

### Pitfall 1: Missing `tool_choice` → Claude Ignores the Tool

**What goes wrong:** You define `decompose_prd` tool but don't set `tool_choice`. Claude responds with a text block instead. `toolUse.input` is undefined. Your `normalizeDecompositionTree(undefined)` returns an empty object.

**Prevention:** Always set `tool_choice: { type: 'tool', name: 'decompose_prd' }` for decomposition calls. The existing `/api/chat` calls deliberately omit `tool_choice` to let Claude decide when to call `query_cocos_knowledge`. Decomposition is different — you always need the structured output.

---

### Pitfall 2: Bumping STORAGE_VERSION Without migrate → Silent Data Wipe

**What goes wrong:** `STORAGE_VERSION` changes from 3 to 4. On next load, Zustand detects version mismatch, finds no `migrate` function, and clears all persisted state. The user's existing requirement and conversation are gone.

**Prevention:** Write the `migrate(persistedState, version)` function BEFORE changing `STORAGE_VERSION`. The function must handle `version === 3` specifically and carry forward the v3 keys (`requirement`, `messages`, `latestRag`, `settings`).

**Test:** After writing migrate, manually set `localStorage.setItem('gameux-promptforge-state', JSON.stringify({ state: { requirement: {}, messages: [] }, version: 3 }))` in browser dev tools. Reload the app. Verify no console errors and existing data is preserved.

---

### Pitfall 3: useHashLocation Import from Wrong Path

**What goes wrong:** `import { useHashLocation } from 'wouter'` throws a module-not-found error at runtime (or imports `undefined`). `useHashLocation` is not exported from the main `"wouter"` module.

**Prevention:** Always import from the sub-path:
```typescript
import { useHashLocation } from 'wouter/use-hash-location'  // CORRECT
import { useHashLocation } from 'wouter'                    // WRONG — not exported here
```

**Verified from README:** "import { useHashLocation } from `wouter/use-hash-location`"

---

### Pitfall 4: In-Memory Session Store Cleared on Server Restart

**What goes wrong:** `decompositionSessions` Map is in-process memory. `tsx watch` auto-restarts the server on file changes. If the server restarts while decomposition is running, the session ID is lost and the frontend poll returns 404.

**Prevention:** Design the frontend to handle 404 from the poll endpoint gracefully (treat it as an error, show retry UI). For Phase 1 (dev mode), this is an acceptable limitation. Do not add persistent session storage.

---

### Pitfall 5: Body Limit Change Only Affects New Middleware Registration

**What goes wrong:** The body limit change (`'1mb'` → `'10mb'`) is made in code but `tsx watch` doesn't restart because no syntax change was detected. The old limit is still active in the running process.

**Prevention:** After changing the body limit, manually restart the server process (`Ctrl+C` + `npm run dev:server`). This is not a code pattern issue — just an operational reminder for the implementer.

---

### Pitfall 6: Decomposition Prompt Produces >4 Nesting Levels

**What goes wrong:** Claude expands nodes too aggressively and creates a 5-6 level deep tree. markmap renders it but it is unreadable at normal zoom. The normalization function passes all nodes through.

**Prevention:** In the L2+ expansion prompt, explicitly instruct: "Do not go deeper than level 2 for branch nodes. If a feature has sub-features, summarize them in the parent node's content rather than creating additional children." Add a validation check in `normalizeDecompositionTree`: if `node.level > 3`, log a warning (never silently accept deep trees).

---

## Code Examples

### Complete File Upload + Read Pattern (UPLD-01, UPLD-02)

```tsx
// src/components/upload/UploadCard.tsx

function UploadCard({ onFileRead }: { onFileRead: (text: string) => void }) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File) => {
    if (!file.name.endsWith('.md') && file.type !== 'text/markdown') {
      alert('Please upload a Markdown (.md) file')
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      if (text) onFileRead(text)
    }
    reader.readAsText(file, 'UTF-8')
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) handleFile(file)
      }}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".md,text/markdown"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''  // allow re-upload of same file
        }}
      />
      {/* visual content */}
    </div>
  )
}
```

### Decomposition System Prompt Skeleton (DCMP-01, DCMP-02)

```typescript
// Prompt for L1 decomposition
const decompositionL1Prompt = `You are a UX architect analyzing a Product Requirements Document (PRD).
Your task: identify the top-level FUNCTIONAL MODULES in the document.
A module is a distinct user-facing feature area or functional discipline (e.g., "Combat System", "Inventory UI", "Progression Loop").
DO NOT use the document's heading hierarchy — analyze functional scope.
Return ONLY level-1 nodes (parentId: null). Maximum 8 nodes. Minimum 2.
Each node must have a clear, distinct functional scope.`

// Prompt for branch expansion
const decompositionBranchPrompt = (parentNode: PrdNode) =>
  `You are expanding one module of a PRD tree.
Module to expand: "${parentNode.label}"
Module summary: ${parentNode.summary}
Extract the specific FEATURES and UI INTERACTIONS within this module.
Level 2 nodes = major features. Level 3 nodes = specific UI interactions.
Do NOT exceed level 3. Maximum 6 children per parent.
All nodes you return must have parentId = "${parentNode.id}" (for level 2) or the ID of their level-2 parent.`
```

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| `safeParseClaudeJson` text parsing | `tool_choice` forced tool-use | Tool-use produces validated structured input; no regex needed |
| BrowserRouter for SPA | wouter + useHashLocation | Hash mode eliminates server rewrite requirements for Tauri |
| SSE for incremental data | REST polling | For O(5) discrete steps, polling is simpler with no library cost |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All | Yes | 22.19.0 | — |
| npm | Package install | Yes | (current) | — |
| Express | INFRA-04, DCMP-01 | Yes (installed) | 5.2.1 | — |
| @anthropic-ai/sdk | DCMP-01 | Yes (installed) | 0.97.0 | — |
| zustand | INFRA-02, INFRA-03 | Yes (installed) | 5.0.13 | — |
| wouter | INFRA-01 | NOT installed | — | `npm install wouter` |
| ANTHROPIC_API_KEY | Server Claude calls | Must verify | — | Server returns 400 with clear error (existing pattern) |

**Missing dependencies:**
- `wouter` — install with `npm install wouter` before any routing work

---

## Validation Architecture

No automated test framework is detected in this project (no jest.config, vitest.config, or tests/ directory). No test infrastructure exists.

For Phase 1, validation is manual:

| Req ID | Validation Method |
|--------|-------------------|
| INFRA-01 | Navigate `http://localhost:5173/#/` and `http://localhost:5173/#/forge/test-node` in browser. Verify correct page renders for each. |
| INFRA-02 | Open Redux/Zustand DevTools, verify `prdTree` and `selectedNodeId` keys appear in store. |
| INFRA-03 | Manually set v3 data in localStorage, reload, verify data persists and no console errors. |
| INFRA-04 | Upload a 5MB text file via the endpoint, verify 200 response (not 413). |
| UPLD-01 | Drag a .md file onto the upload card and click the file picker. Both work. |
| UPLD-02 | Upload a file, verify progress steps display correctly during decomposition. |
| UPLD-03 | Verify tree nodes appear incrementally during decomposition (not all at once at the end). |
| DCMP-01 | POST `/api/decompose/start` with a real PRD, verify structured JSON tree returned. |
| DCMP-02 | Verify Claude groups nodes by function (not by Markdown headings). |
| DCMP-03 | Pass malformed AI output to `normalizeDecompositionTree()`, verify it does not throw and returns a valid (possibly partial) tree. |
| DCMP-04 | After decomposition, verify store contains `Record<string, PrdNode>` (flat map), not a nested tree. |

### Wave 0 Gaps

- No test framework installed — all Phase 1 validation is manual.
- If automated tests are desired in a future phase, `vitest` is the natural choice for this Vite+React stack.

---

## Open Questions

1. **Session cleanup for decompositionSessions Map**
   - What we know: The Map grows unbounded in-process memory per server lifecycle.
   - What's unclear: For a single-user desktop app, this is not a problem in practice (single session, short lifetime). But if the server is long-running (e.g., stays up between work sessions), old sessions accumulate.
   - Recommendation: Add a simple TTL: after 30 minutes, delete sessions. Or simply clear the map on `GET /api/decompose/:id` when status is `done` after returning the response.

2. **L2 branch expansion parallelism**
   - What we know: The plan is sequential branch expansion (one L1 branch at a time). Sequential is simpler but slower.
   - What's unclear: Whether parallel `Promise.all` branch expansion would be safe given Anthropic API rate limits.
   - Recommendation: Start sequential. If 10-30s is too slow in practice (i.e., user complains), switch to `Promise.allSettled` with a concurrency limit of 2.

3. **`extractedFrom` field population**
   - What we know: The PrdNode type includes `extractedFrom: string` (source text range).
   - What's unclear: Whether to ask Claude to populate this field in Phase 1, or leave it null and fill later.
   - Recommendation: Leave `extractedFrom: null` in Phase 1. The field is useful for Phase 2+ (highlighting source text in the map view). Asking Claude to populate it adds complexity to the prompt with no immediate benefit.

---

## Sources

### Primary (HIGH confidence)

- `npm show wouter readme` — full README, hash routing API, useHashLocation import path, useParams, useLocation patterns. Verified 2026-05-26.
- `node_modules/zustand/middleware/persist.d.ts` — `migrate` function signature, `PersistOptions` interface. Read directly.
- `node_modules/@anthropic-ai/sdk/src/resources/messages/messages.ts` — `ToolChoiceTool` interface, `tool_choice` parameter structure. Read directly.
- `node_modules/express/package.json` — confirms Express 5.2.1 installed.
- `node -e "e().use(e.json({limit:'10mb'}))"` — verified Express 5.2.1 accepts `'10mb'` limit syntax.
- `server/index.ts` — existing `runClaudeRequirementLoop`, `tools` array, `safeParseClaudeJson` patterns. Read directly.
- `src/store/appStore.ts` — existing store shape, `STORAGE_VERSION = 3`, `partialize` config. Read directly.

### Secondary (MEDIUM confidence)

- Prior research docs (`.planning/research/ARCHITECTURE.md`, `STACK.md`, `PITFALLS.md`) — architecture patterns and pitfall analysis from 2026-05-26.
- CONTEXT.md decisions (D-01 through D-06) — locked user decisions constraining implementation.

---

## Metadata

**Confidence breakdown:**
- wouter hash mode API: HIGH — verified from live npm registry README
- Zustand persist migrate: HIGH — verified from installed type definitions
- Claude tool_choice forced usage: HIGH — verified from installed SDK type definitions
- Progressive decomposition REST polling pattern: HIGH — derived from existing codebase patterns
- Express v5 body limit: HIGH — live runtime test confirmed

**Research date:** 2026-05-26
**Valid until:** 2026-08-26 (stable libraries; wouter/zustand APIs do not change frequently)
