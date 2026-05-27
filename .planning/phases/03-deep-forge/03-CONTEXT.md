---
phase: 03-deep-forge
status: Ready for planning
gathered: 2026-05-27
---

# Phase 3: Deep Forge - Context

**Gathered:** 2026-05-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can open any node from the mindmap in a dedicated "Deep Forge" view, hold an AI-assisted chat session to polish that node's requirements, and confirm the node as complete — at which point the node's status updates to 'done' and the user auto-navigates back to the map. This phase replaces the ForgePage stub from Phase 1.

Scope: ForgePage UI, per-node chat history, `/api/node-chat` server endpoint, and node status confirmation. AI polishing of export documents is Phase 4.

</domain>

<decisions>
## Implementation Decisions

### ForgePage Layout
- **D-01:** Two-column full-screen layout. Left panel (fixed ~360px): node details (ID badge, type badge, title, summary, techNotes, current status). Right panel (flex-1): ForgeChat (message history + input area). Full-screen wrapper `h-screen flex flex-col`. Header row: "← Back to Map" button (left), node breadcrumb title (center), "Confirm Complete" button (right).
- **D-02:** Reuse Forge Blueprint tokens throughout. Left panel background: `bg-surface-container`, right panel background: `bg-background blueprint-grid`. Header: same `h-16 px-lg` as TopAppBar. "Confirm Complete" uses `bg-secondary-container` when inactive (dim), `bg-tertiary-container text-on-tertiary-container` glow when `nodeComplete` is true.
- **D-03:** No new design mockup exists for ForgePage — use Image 2.html color tokens and spacing as the reference system, matching the map view aesthetic.

### Per-Node Chat Storage
- **D-04:** Add `nodeChats: Record<string, ChatMessage[]>` to the Zustand store. **NOT included in `partialize`** — session-only, matches PRST-02 v2 deferral. New actions: `appendNodeMessage(nodeId: string, msg: ChatMessage)` and `clearNodeChat(nodeId: string)`.
- **D-05:** Initial message for each node's chat: a system-style welcome that states the node title and invites polishing. Prepended automatically when ForgePage mounts if `nodeChats[nodeId]` is empty or undefined.
- **D-06:** `ChatMessage` type from `src/types/chat.ts` is reused as-is. No new type needed.

### AI Completion Signal
- **D-07:** Extend the Phase 1 `state_patch` pattern. `/api/node-chat` response shape: `{ reply: string, nodeComplete: boolean }`. Server instructs Claude to set `nodeComplete: true` in a lightweight JSON suffix when it judges the requirements are sufficiently explored and polished.
- **D-08:** Frontend reads `nodeComplete` from the response. When `true`, the "Confirm Complete" button transitions to highlighted state (`active-glow` class + `bg-tertiary-container` color). It does NOT auto-confirm — the user still clicks.
- **D-09:** `nodeComplete` state is local to `ForgePage` (React `useState`). It resets to `false` when the user navigates away and returns. It is NOT persisted.

### Confirmation Flow
- **D-10:** "Confirm Complete" button is **always visible** (not gated on AI suggestion). User can confirm at any time, AI suggestion only highlights it.
- **D-11:** On confirm click: call `updateNodeStatus(nodeId, 'done')` store action → then `navigate('/')`. The map view automatically reflects the status change via Zustand reactivity (`NodeCard` reads `node.status`).
- **D-12:** Add `updateNodeStatus(nodeId: string, status: PrdNode['status'])` action to `appStore.ts`. Implementation: `set(state => ({ prdTree: { ...state.prdTree, [nodeId]: { ...state.prdTree![nodeId], status } } }))`.

### Server Endpoint `/api/node-chat`
- **D-13:** POST `/api/node-chat`. Request body: `{ nodeId: string, messages: ChatMessage[], tree: Record<string, PrdNode> }`. Response: `{ reply: string, nodeComplete: boolean }`. Simple JSON (not SSE) — consistent with existing `/api/chat`.
- **D-14:** System prompt injects: target node's `label`, `summary`, `content`, `techNotes`, `type`; plus parent node's `label` + `summary` (if `parentId` exists in tree). This satisfies FORG-06 (cross-node reference) without a user-triggered picker.
- **D-15:** Server instructs Claude to respond in Chinese, keep replies concise (≤8 lines), ask the single most blocking question if requirements are incomplete, and include `{ "nodeComplete": true }` as a JSON suffix when ready to confirm (same parse pattern as `state_patch`).

### Components
- **D-16:** New files: `src/pages/ForgePage.tsx` (replaces stub), `src/components/map/ForgeChat.tsx` (chat panel), `src/components/map/ForgeNodePanel.tsx` (left node details).
- **D-17:** `ForgeChat` props: `{ nodeId, messages, nodeComplete, onSend, onConfirm, onBack }`. Manages its own loading/error states internally. `onSend` is an async function from ForgePage that calls the API and appends messages.
- **D-18:** `ForgeNodePanel` props: `{ node: PrdNode }`. Read-only display. Shows: type badge, ID badge, title, summary, optional techNotes section, current status badge. No editing.

### Claude's Discretion
- Exact system prompt wording for `/api/node-chat` — keep it concise, Chinese-first, consistent with Phase 1 chat tone
- Error state UI in ForgeChat (e.g., API failure banner) — reuse `text-error` color tokens
- Loading spinner style while awaiting AI response — keep consistent with existing DecompProgress style

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design System
- `stitch/main/Image 2.html` — Canonical Forge Blueprint token usage: color names, spacing classes, component structure. Use for all ForgePage styling decisions.
- `stitch/main/Image 3.markdown` — Full Forge Blueprint design token definitions (colors, typography, spacing).

### Existing Code to Extend
- `src/pages/ForgePage.tsx` — Current stub to replace. Has `useParams<{ nodeId }>` and `useLocation` already imported.
- `src/store/appStore.ts` — Zustand store. Add `nodeChats`, `appendNodeMessage`, `clearNodeChat`, `updateNodeStatus`.
- `src/types/chat.ts` — `ChatMessage` type to reuse for per-node chat messages.
- `src/types/prdNode.ts` — `PrdNode` type, `status: 'pending' | 'done'` field.
- `server/index.ts` — Express server. Add `/api/node-chat` endpoint following the `/api/chat` pattern (lines ~570–650).
- `src/lib/api.ts` — HTTP client. Add `sendNodeChatMessage()` function following `sendChatMessage` pattern.

### Phase Patterns to Follow
- `.planning/phases/02-mindmap-preview/02-CONTEXT.md` — D-11 CSS width transition, D-06 TopAppBar layout pattern. ForgePage header should match TopAppBar height and style.
- `.planning/phases/01-prd-upload-decompose/01-CONTEXT.md` — Phase 1 `state_patch` pattern (server embeds JSON in reply, client parses it). Phase 3 uses same parse-JSON-from-reply pattern for `nodeComplete`.

### Requirements
- `.planning/REQUIREMENTS.md` §FORG-01 through FORG-07 — all Phase 3 acceptance criteria.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/types/chat.ts` — `ChatMessage` type (`role: 'user' | 'assistant'`, `content: string | ContentBlock[]`) — reuse for per-node messages
- `src/components/upload/TreeSummary.tsx` — ID badge pattern (`font-code-sm text-on-primary-container`) — reuse in ForgeNodePanel
- `src/components/map/TopAppBar.tsx` — Header layout pattern (`h-16 px-lg flex justify-between items-center bg-surface border-b`) — reuse for ForgePage header
- `src/index.css` — `active-glow`, `node-glow`, `animate-fade-in` — reuse for Confirm button glow state
- `tailwind.config.js` — All Forge Blueprint tokens available (tertiary-container, on-tertiary-container, etc.)

### Established Patterns
- State management: Single Zustand selector per value. Follow `useAppStore((s) => s.nodeChats)` pattern.
- API: `requestJson<T>` helper in `src/lib/api.ts` — all new endpoints go through it.
- Server: Phase 1 `/api/chat` handler shows the exact pattern: parse body, build system prompt, call `anthropic.messages.create()`, parse JSON from reply, return structured response.
- Navigation: `const [, navigate] = useLocation()` from wouter — already imported in ForgePage stub.

### Integration Points
- `src/pages/ForgePage.tsx` — Receives `nodeId` from wouter params → looks up `prdTree[nodeId]` in Zustand → mounts `ForgeNodePanel` + `ForgeChat`
- `src/store/appStore.ts` — `prdTree` is already persisted; `nodeChats` is NOT persisted (session-only)
- `server/index.ts` — New `/api/node-chat` route added after existing `/api/chat` route
- Map view `NodeCard` — automatically shows "Generated" badge when `node.status === 'done'` (no extra wiring needed)

</code_context>

<specifics>
## Specific Ideas

- The `nodeComplete` JSON suffix from Claude should be parsed the same way as `state_patch`: look for `{ "nodeComplete": true }` as a JSON object within the reply string, extract it, and strip it from the displayed reply text. This reuses the existing `safeParseClaudeJson` / `stripJsonEcho` server functions.
- ForgePage "Back to Map" button: `navigate('/')` — same as the Phase 1 stub.
- The initial auto-message to the user when entering a Forge session: `"正在为节点 {node.label}（{node.id}）开启深度打磨。请告诉我这个节点最让你不清楚的交互细节，我们从那里开始。"` — this is the first assistant message prepended to the chat.
- "Confirm Complete" button label: use `"确认完成"` (Chinese) + `check_circle` icon when highlighted.

</specifics>

<deferred>
## Deferred Ideas

- PRST-02: Per-node chat persistence (IndexedDB/localStorage) — explicitly v2, not in this phase.
- User-triggered "Add context" picker for cross-node references — v1 auto-injects parent only; user picker is a v2 enhancement.
- Streaming SSE responses for real-time text generation — v1 uses simple JSON POST/response for consistency.
- Rich content in chat (images, code blocks with syntax highlighting) — v1 is text-only.

</deferred>

---

*Phase: 03-deep-forge*
*Context gathered: 2026-05-27*
