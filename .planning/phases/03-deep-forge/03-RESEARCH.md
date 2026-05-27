# Phase 3: Deep Forge - Research

**Researched:** 2026-05-27
**Domain:** React + Zustand + Express + Claude API — per-node chat, store extension, AI completion signal
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Two-column full-screen layout. Left panel (~360px fixed): ForgeNodePanel. Right panel (flex-1): ForgeChat. Header h-16 with Back, breadcrumb, Confirm Complete.
- **D-02:** Forge Blueprint tokens throughout. Left bg-surface-container, right bg-background blueprint-grid. Confirm Complete: bg-secondary-container dim → bg-tertiary-container text-on-tertiary-container + active-glow when nodeComplete=true.
- **D-03:** No new design mockup — use Image 2.html tokens and spacing as reference system.
- **D-04:** `nodeChats: Record<string, ChatMessage[]>` in Zustand. NOT in partialize. Actions: `appendNodeMessage(nodeId, msg)` and `clearNodeChat(nodeId)`.
- **D-05:** Auto-prepend initial assistant welcome message when ForgePage mounts if nodeChats[nodeId] is empty/undefined.
- **D-06:** `ChatMessage` from `src/types/chat.ts` reused as-is. No new type.
- **D-07:** `/api/node-chat` response shape: `{ reply: string, nodeComplete: boolean }`. Claude sets nodeComplete:true as JSON suffix when requirements are sufficiently explored.
- **D-08:** Frontend reads nodeComplete. When true, Confirm Complete button transitions to highlighted (active-glow + bg-tertiary-container). Does NOT auto-confirm.
- **D-09:** nodeComplete is local React useState in ForgePage. Resets on navigation. NOT persisted.
- **D-10:** Confirm Complete button always visible, not gated on AI suggestion.
- **D-11:** On confirm: `updateNodeStatus(nodeId, 'done')` → `navigate('/')`.
- **D-12:** `updateNodeStatus(nodeId: string, status: PrdNode['status'])` action. Implementation: `set(state => ({ prdTree: { ...state.prdTree, [nodeId]: { ...state.prdTree![nodeId], status } } }))`.
- **D-13:** POST `/api/node-chat`. Body: `{ nodeId: string, messages: ChatMessage[], tree: Record<string, PrdNode> }`. Response: `{ reply: string, nodeComplete: boolean }`. Simple JSON.
- **D-14:** System prompt injects target node's label, summary, content, techNotes, type + parent node's label + summary (if parentId exists in tree).
- **D-15:** Server instructs Claude to respond in Chinese, ≤8 lines, ask single most-blocking question, include `{"nodeComplete": true}` as JSON suffix when ready.
- **D-16:** New files: `src/pages/ForgePage.tsx`, `src/components/map/ForgeChat.tsx`, `src/components/map/ForgeNodePanel.tsx`.
- **D-17:** ForgeChat props: `{ nodeId, messages, nodeComplete, onSend, onConfirm, onBack }`. Manages its own loading/error states.
- **D-18:** ForgeNodePanel props: `{ node: PrdNode }`. Read-only. Shows type badge, ID badge, title, summary, techNotes, status badge.

### Claude's Discretion

- Exact system prompt wording for `/api/node-chat` — keep concise, Chinese-first, consistent with Phase 1 chat tone.
- Error state UI in ForgeChat — reuse `text-error` color tokens.
- Loading spinner style — keep consistent with existing DecompProgress style (three bouncing dots).

### Deferred Ideas (OUT OF SCOPE)

- PRST-02: Per-node chat persistence (IndexedDB/localStorage) — session-only in this phase.
- User-triggered "Add context" picker for cross-node references — v1 auto-injects parent only.
- Streaming SSE responses — v1 uses simple JSON POST/response.
- Rich content in chat (images, code blocks with syntax highlighting) — v1 is text-only.

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FORG-01 | Each node has independent chat history | D-04: nodeChats Record in Zustand, session-only. appendNodeMessage/clearNodeChat actions. |
| FORG-02 | ChatPanel and StateCanvas receive node context via props (not reading global store directly) | D-17/D-18: ForgeChat and ForgeNodePanel receive all data via props. ForgePage is the single store reader. |
| FORG-03 | AI evaluates completion and suggests confirmation | D-07/D-15: nodeComplete boolean in response, JSON suffix parse pattern. |
| FORG-04 | User can manually confirm node complete | D-10/D-11: always-visible Confirm button, updateNodeStatus action. |
| FORG-05 | Confirmed node auto-navigates back to map | D-11: navigate('/') after updateNodeStatus. |
| FORG-06 | Forge can reference other node content as context | D-14: parent node's label+summary auto-injected into system prompt. Tree passed to server. |
| FORG-07 | Server /api/node-chat endpoint injects node content into prompt | D-13/D-14: POST body contains nodeId + tree; server builds context from target + parent. |

</phase_requirements>

---

## Summary

Phase 3 replaces the ForgePage stub with a two-column Deep Forge UI: a read-only node detail panel (left) and an AI-assisted chat panel (right). Each node gets its own session-scoped chat history in Zustand (`nodeChats: Record<string, ChatMessage[]>`, not persisted). The server exposes a new `/api/node-chat` endpoint that follows the exact same pattern as `/api/chat` — parse body, build system prompt with node context, call `anthropic.messages.create()`, parse a JSON suffix (`{ "nodeComplete": true }`) from the reply, return structured JSON.

The AI completion signal pattern is a close analog of the Phase 1 `state_patch` mechanism: Claude is instructed to embed `{"nodeComplete": true}` at the end of its reply when requirements are sufficiently explored. The server strips this JSON from the display text and returns it as a separate boolean field. The frontend uses this to visually highlight the Confirm Complete button — but the user must still click it.

The store migration is low-risk: adding `nodeChats` to the interface without adding it to `partialize` does NOT require a version bump. The STORAGE_VERSION (currently 4) only needs bumping when the persisted shape changes, and session-only fields explicitly stay out of `partialize`.

**Primary recommendation:** Follow the `/api/chat` endpoint as the implementation template for `/api/node-chat`. Reuse `safeParseClaudeJson` / `stripJsonEcho` for `nodeComplete` extraction. Add `nodeChats` to the store interface without touching `partialize` or bumping the version.

---

## Standard Stack

No new packages needed. All capabilities required for Phase 3 are already in the project.

### Core (Existing)
| Library | Version | Purpose | Phase 3 Use |
|---------|---------|---------|-------------|
| React | latest | Component model | ForgePage + new component files |
| Zustand ^5.0.13 | current | Global state | Add nodeChats, appendNodeMessage, clearNodeChat, updateNodeStatus |
| wouter | current | Routing | useParams, useLocation already in ForgePage stub |
| @anthropic-ai/sdk ^0.97.1 | current | Claude API | /api/node-chat server endpoint |
| Express ^5.2.1 | current | HTTP server | New POST /api/node-chat route |
| Tailwind CSS ^3.4.17 | current | Styling | Forge Blueprint tokens: tertiary-container, on-tertiary-container, active-glow |

### No New Dependencies Required
Phase 3 adds zero new npm packages. All needed utilities exist: `safeParseClaudeJson`, `stripJsonEcho`, `textFromClaudeContent`, `requestJson<T>`, `ChatMessage` type, CSS classes `active-glow` / `blueprint-grid` / `animate-fade-in`.

---

## Architecture Patterns

### New Files

```
src/
├── pages/
│   └── ForgePage.tsx          -- Replaces stub. Orchestrator. Reads store, owns async send logic.
├── components/map/
│   ├── ForgeChat.tsx           -- Right panel: message list + input area
│   └── ForgeNodePanel.tsx      -- Left panel: read-only node detail display
server/
└── index.ts                   -- Add /api/node-chat route (after existing /api/chat)
src/
├── store/appStore.ts           -- Add nodeChats, appendNodeMessage, clearNodeChat, updateNodeStatus
└── lib/api.ts                  -- Add sendNodeChatMessage()
```

### Pattern 1: Store Extension Without Version Bump

**What:** Add `nodeChats: Record<string, ChatMessage[]>` to `AppStoreState` interface and initial state. Add three new actions. Do NOT add `nodeChats` to `partialize`. Do NOT increment `STORAGE_VERSION`.

**Why safe:** Zustand `persist` middleware only serializes what `partialize` returns. Fields absent from `partialize` are session-only by definition. Adding a field to the interface without adding it to `partialize` is a pure additive change — existing persisted state at version 4 will hydrate cleanly and the new `nodeChats` field will be initialized to `{}` from the initial state default.

**When to bump version:** Only when a persisted field is renamed, removed, or its type changes in a backwards-incompatible way. That does not happen in Phase 3.

```typescript
// src/store/appStore.ts — additions only, no changes to existing code

// In AppStoreState interface:
nodeChats: Record<string, ChatMessage[]>
appendNodeMessage: (nodeId: string, msg: ChatMessage) => void
clearNodeChat: (nodeId: string) => void
updateNodeStatus: (nodeId: string, status: PrdNode['status']) => void

// In initial state object:
nodeChats: {},

// Action implementations:
appendNodeMessage: (nodeId, msg) =>
  set((state) => ({
    nodeChats: {
      ...state.nodeChats,
      [nodeId]: [...(state.nodeChats[nodeId] ?? []), msg],
    },
  })),
clearNodeChat: (nodeId) =>
  set((state) => {
    const { [nodeId]: _, ...rest } = state.nodeChats
    return { nodeChats: rest }
  }),
updateNodeStatus: (nodeId, status) =>
  set((state) => ({
    prdTree: {
      ...state.prdTree,
      [nodeId]: { ...state.prdTree![nodeId], status },
    },
  })),

// partialize: unchanged — nodeChats intentionally NOT added
```

### Pattern 2: /api/node-chat Endpoint (follows /api/chat exactly)

**What:** POST handler that builds a context-aware system prompt from the target node + parent, calls `anthropic.messages.create()` with no tools (simple turn, no tool loop needed), parses the `nodeComplete` boolean from the reply using the same `safeParseClaudeJson` helper, strips it from the displayed text.

**Key difference from /api/chat:** No agentic tool loop (`runClaudeRequirementLoop`). Phase 3 does not use the Cocos RAG tool — it's a direct single call. No state_patch normalization needed. Response is simpler.

```typescript
// server/index.ts — new interface and route

interface NodeChatRequest {
  nodeId: string
  messages: ChatMessage[]
  tree: Record<string, PrdNode>
}

// Add after existing /api/chat route:
app.post('/api/node-chat', async (req, res) => {
  const { nodeId, messages, tree } = req.body as NodeChatRequest

  if (!nodeId || !messages?.length || !tree) {
    res.status(400).json({ error: 'nodeId, messages, and tree are required' })
    return
  }

  if (!anthropic) {
    res.status(400).json({ error: 'ANTHROPIC_API_KEY is not configured.' })
    return
  }

  const targetNode = tree[nodeId]
  if (!targetNode) {
    res.status(400).json({ error: `Node ${nodeId} not found in tree` })
    return
  }

  const parentNode = targetNode.parentId ? tree[targetNode.parentId] : null

  const nodeContext = `目标节点：
ID: ${targetNode.id}
类型: ${targetNode.type}
标题: ${targetNode.label}
摘要: ${targetNode.summary}
内容: ${targetNode.content}${targetNode.techNotes ? `\n技术备注: ${targetNode.techNotes}` : ''}${parentNode ? `\n\n父节点上下文：\n标题: ${parentNode.label}\n摘要: ${parentNode.summary}` : ''}`

  const nodeChatSystemPrompt = `你是游戏UX交互设计顾问，专注于帮助设计师打磨单个UI节点的交互需求。

${nodeContext}

你的任务：通过对话帮助用户明确这个节点的所有交互细节，直到需求足够精确可以交付给开发工程师。

规则：
- 用中文回复
- 每次最多回复8行
- 如果需求还不完整，只问一个最关键的问题
- 当你判断该节点的交互需求已经足够详细和精确时，在回复末尾附加：{"nodeComplete": true}
- 不要在回复正文中暴露JSON或大括号
- 保持专业、简洁、直接的语气`

  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    system: nodeChatSystemPrompt,
    messages: messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : extractText(m.content),
    })),
  })

  const rawText = textFromClaudeContent(response.content)
  // Reuse existing safeParseClaudeJson to detect {"nodeComplete": true}
  const parsed = safeParseClaudeJson(rawText) as { reply?: string; nodeComplete?: boolean }
  const nodeComplete = parsed.nodeComplete === true

  // Strip the JSON suffix from display text
  const reply = parsed.reply ?? stripJsonEcho(rawText)

  res.json({ reply, nodeComplete })
})
```

**IMPORTANT:** `safeParseClaudeJson` currently types its return as `{ reply?: string; state_patch?: ... }`. For the node-chat endpoint, cast the return value to a wider type or write a separate local parse that looks only for `nodeComplete`. The safest approach is to reuse `safeParseClaudeJson` but cast to `unknown` and then check for `nodeComplete` property — this avoids modifying a shared utility.

### Pattern 3: ForgePage — Store Reading and Send Orchestration

**What:** ForgePage is the sole Zustand reader. It passes slices to child components via props. This satisfies FORG-02.

```typescript
// src/pages/ForgePage.tsx (replaces stub)
export function ForgePage() {
  const { nodeId } = useParams<{ nodeId: string }>()
  const [, navigate] = useLocation()
  
  // Store reads — all at top level, passed as props
  const prdTree = useAppStore((s) => s.prdTree)
  const nodeChats = useAppStore((s) => s.nodeChats)
  const settings = useAppStore((s) => s.settings)
  const appendNodeMessage = useAppStore((s) => s.appendNodeMessage)
  const updateNodeStatus = useAppStore((s) => s.updateNodeStatus)
  
  const [nodeComplete, setNodeComplete] = useState(false)
  
  const node = prdTree?.[nodeId ?? ''] ?? null
  const messages = nodeChats[nodeId ?? ''] ?? []
  
  // Auto-prepend welcome message on first mount (D-05)
  useEffect(() => {
    if (!nodeId || messages.length > 0) return
    appendNodeMessage(nodeId, {
      role: 'assistant',
      content: `正在为节点 ${node?.label}（${nodeId}）开启深度打磨。请告诉我这个节点最让你不清楚的交互细节，我们从那里开始。`,
    })
  }, [nodeId]) // eslint-disable-line
  
  // Send handler — async, calls /api/node-chat
  async function handleSend(text: string) {
    if (!nodeId || !prdTree || !node) return
    const userMsg: ChatMessage = { role: 'user', content: text }
    appendNodeMessage(nodeId, userMsg)
    const currentMessages = [...messages, userMsg]
    try {
      const response = await sendNodeChatMessage(settings.proxyBaseUrl, nodeId, currentMessages, prdTree)
      appendNodeMessage(nodeId, { role: 'assistant', content: response.reply })
      if (response.nodeComplete) setNodeComplete(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : '发送失败'
      appendNodeMessage(nodeId, { role: 'assistant', content: `请求失败：${message}` })
    }
  }
  
  function handleConfirm() {
    if (!nodeId) return
    updateNodeStatus(nodeId, 'done')
    navigate('/')
  }
  
  if (!node) {
    // Node not found — navigate back
    navigate('/')
    return null
  }
  
  return (
    <div className="w-full h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="h-16 px-lg flex justify-between items-center bg-surface border-b border-outline-variant z-20 shrink-0">
        {/* Back button, breadcrumb, Confirm Complete */}
      </header>
      <main className="flex-1 flex overflow-hidden">
        <ForgeNodePanel node={node} />
        <ForgeChat
          nodeId={nodeId}
          messages={messages}
          nodeComplete={nodeComplete}
          onSend={handleSend}
          onConfirm={handleConfirm}
          onBack={() => navigate('/')}
        />
      </main>
    </div>
  )
}
```

### Pattern 4: api.ts — sendNodeChatMessage

**What:** New function following the exact same `requestJson<T>` pattern as `sendChatMessage`.

```typescript
// src/lib/api.ts — add after sendChatMessage

export interface NodeChatResponse {
  reply: string
  nodeComplete: boolean
}

export function sendNodeChatMessage(
  baseUrl: string,
  nodeId: string,
  messages: ChatMessage[],
  tree: Record<string, PrdNode>
) {
  return requestJson<NodeChatResponse>(baseUrl, '/api/node-chat', {
    method: 'POST',
    body: JSON.stringify({ nodeId, messages, tree }),
  })
}
```

### Anti-Patterns to Avoid

- **Reading prdTree or settings directly in ForgeChat/ForgeNodePanel:** Violates FORG-02. ForgePage is the sole store reader; pass via props.
- **Bumping STORAGE_VERSION for session-only field additions:** nodeChats is not in partialize, so no migration is needed and no version bump is warranted.
- **Using the full `runClaudeRequirementLoop` agentic loop:** /api/node-chat uses a single direct call to `anthropic.messages.create()`. No tools, no loop. The Cocos RAG tool is irrelevant here.
- **Auto-confirming when nodeComplete is true:** D-08 is explicit — nodeComplete=true only highlights the button. The user must click.
- **Persisting nodeChats in localStorage:** PRST-02 is explicitly deferred. Keep it session-only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON suffix extraction from Claude reply | Custom regex parser | `safeParseClaudeJson` + `stripJsonEcho` (already in server/index.ts) | Handles multi-candidate parsing, graceful fallback |
| HTTP client with error handling | New fetch wrapper | `requestJson<T>` in src/lib/api.ts | Already handles non-JSON responses, error field extraction |
| Chat message rendering | New renderer | Copy `renderMessageContent` from ChatPanel.tsx | Already handles string vs ContentBlock[] (though ForgeChat is text-only, the type is shared) |
| Confirm button glow | Custom CSS | `active-glow` class in src/index.css | Already defined: `box-shadow: 0 0 20px -3px rgba(78, 222, 163, 0.3); border-color: #4edea3` |
| Blueprint grid background | Custom CSS | `blueprint-grid` class in src/index.css | Already defined with the correct dot-grid pattern |
| ID badge styling | Custom component | `text-code-sm text-on-primary-container` tokens | Pattern from TreeSummary.tsx line 39: `<span className="text-code-sm text-on-primary-container">` |

**Key insight:** Phase 3 is almost entirely wiring and composition of existing patterns. Nearly every utility, class, and type it needs already exists in the codebase.

---

## Common Pitfalls

### Pitfall 1: safeParseClaudeJson Type Cast for nodeComplete
**What goes wrong:** `safeParseClaudeJson` returns `{ reply?: string; state_patch?: Partial<UXRequirementState> }`. If you call `parsed.nodeComplete`, TypeScript will error because `nodeComplete` is not in the return type.
**Why it happens:** The function was typed for Phase 1's response shape.
**How to avoid:** Cast the return to `unknown` then to a local interface, OR parse the JSON independently in the `/api/node-chat` handler. The simplest approach: write a local `parseNodeChatReply(text: string): { reply: string; nodeComplete: boolean }` that reuses the same two-candidate extraction logic but has the right return type. Alternatively, cast: `const parsed = safeParseClaudeJson(rawText) as unknown as { reply?: string; nodeComplete?: boolean }`.
**Warning signs:** TypeScript compile error on `parsed.nodeComplete`.

### Pitfall 2: Initial Welcome Message Double-Prepend
**What goes wrong:** If `appendNodeMessage` is called in a `useEffect` with empty deps and the component re-renders (e.g., React StrictMode double-invoke), the welcome message appears twice.
**Why it happens:** React StrictMode in dev mode invokes effects twice. The guard `if (messages.length > 0) return` uses the stale closure value of `messages` at effect invocation time.
**How to avoid:** Read `nodeChats[nodeId]` directly from `useAppStore.getState()` inside the effect rather than from the closed-over `messages` variable. Or check the store value at call time: `if (useAppStore.getState().nodeChats[nodeId]?.length) return`.
**Warning signs:** Two welcome messages visible on first open in dev mode.

### Pitfall 3: updateNodeStatus on Null prdTree
**What goes wrong:** `updateNodeStatus` implementation does `{ ...state.prdTree, [nodeId]: { ...state.prdTree![nodeId], status } }`. If `prdTree` is null (e.g., navigating to /forge/:nodeId directly without decomposing), this throws.
**Why it happens:** The `!` non-null assertion bypasses TypeScript's check.
**How to avoid:** Add a guard: `if (!state.prdTree?.[nodeId]) return state`. Since ForgePage already checks `if (!node) navigate('/')`, in practice prdTree cannot be null when updateNodeStatus is called — but the action should be defensive.
**Warning signs:** Runtime error "Cannot read properties of null (reading 'nodeId')".

### Pitfall 4: Messages Array Stale Closure in handleSend
**What goes wrong:** `handleSend` closes over `messages` from the render. If multiple messages are sent in rapid succession, each call works from the same stale `messages` array and only the last one persists correctly.
**Why it happens:** `messages` is derived from `nodeChats[nodeId]` at render time, not from store at call time.
**How to avoid:** In `handleSend`, read the current messages from the store at call time: `const currentMessages = useAppStore.getState().nodeChats[nodeId] ?? []`. Then append the new user message locally for the API call. Since `appendNodeMessage` mutates the store synchronously before the async call, reading `getState()` in the callback gives the latest value.
**Warning signs:** Chat history missing messages after fast back-to-back sends.

### Pitfall 5: nodeComplete Carries Over on Re-navigation
**What goes wrong:** User enters Forge for node A, AI signals nodeComplete=true. User hits Back. User enters Forge for node B. `nodeComplete` is still true from node A.
**Why it happens:** If `nodeComplete` is stored outside the component (e.g., in a module-level variable or in Zustand), it persists across navigations.
**How to avoid:** D-09 is explicit: `nodeComplete` is `React.useState(false)` local to `ForgePage`. Because wouter unmounts ForgePage when navigating to `/`, the state resets automatically. This is the correct approach — no extra cleanup needed.
**Warning signs:** Confirm button appears pre-highlighted when entering a new node.

---

## Code Examples

### /api/node-chat JSON suffix detection (server)
```typescript
// Source: server/index.ts existing safeParseClaudeJson pattern (lines 163-181)
// For node-chat, cast return type to handle nodeComplete field:
const rawText = textFromClaudeContent(response.content)
const firstBrace = rawText.lastIndexOf('{')  // Use LAST brace — suffix is at end
const lastBrace = rawText.lastIndexOf('}')
let nodeComplete = false
let displayReply = rawText

if (firstBrace !== -1 && lastBrace > firstBrace) {
  try {
    const suffix = JSON.parse(rawText.slice(firstBrace, lastBrace + 1)) as { nodeComplete?: boolean }
    if (suffix.nodeComplete === true) {
      nodeComplete = true
      displayReply = rawText.slice(0, firstBrace).trim()
    }
  } catch {
    // No valid JSON suffix — nodeComplete stays false
  }
}

res.json({ reply: displayReply || rawText, nodeComplete })
```

Note: Using `lastIndexOf` for `{` rather than `indexOf` is more robust because Claude may mention JSON in its reply text before appending the actual suffix at the end. However, `safeParseClaudeJson` uses `indexOf` (first brace). For `nodeComplete` suffix detection, searching from the LAST `{` is slightly more reliable. Either approach works — the key is that Claude is instructed to put the JSON at the very end.

### Confirm Complete button state (client)
```typescript
// src/pages/ForgePage.tsx — button conditional styling
<button
  onClick={handleConfirm}
  className={[
    'flex items-center gap-sm rounded-lg px-md py-sm font-label-md text-label-md transition-all min-h-[44px]',
    nodeComplete
      ? 'bg-tertiary-container text-on-tertiary-container active-glow border border-tertiary'
      : 'bg-secondary-container text-on-secondary-container opacity-60 border border-outline-variant',
  ].join(' ')}
>
  <span className="material-symbols-outlined" style={{ fontSize: '16px', fontVariationSettings: nodeComplete ? "'FILL' 1" : "'FILL' 0" }}>
    check_circle
  </span>
  确认完成
</button>
```

### Store selector pattern in ForgePage (single selector per value)
```typescript
// Follow existing appStore pattern: one selector per value, not destructured object
const prdTree = useAppStore((s) => s.prdTree)
const nodeChats = useAppStore((s) => s.nodeChats)
const appendNodeMessage = useAppStore((s) => s.appendNodeMessage)
const updateNodeStatus = useAppStore((s) => s.updateNodeStatus)
```

### Auto-welcome message guard (safe against StrictMode double-invoke)
```typescript
useEffect(() => {
  if (!nodeId || !node) return
  // Read from store directly, not from stale closure
  if ((useAppStore.getState().nodeChats[nodeId] ?? []).length > 0) return
  appendNodeMessage(nodeId, {
    role: 'assistant',
    content: `正在为节点 ${node.label}（${nodeId}）开启深度打磨。请告诉我这个节点最让你不清楚的交互细节，我们从那里开始。`,
  })
}, [nodeId, node?.label]) // Re-runs if nodeId changes (user navigated to different node)
```

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|-----------------|-------|
| Phase 1 state_patch JSON suffix | Phase 3 nodeComplete JSON suffix | Same mechanism, different payload shape. Both use safeParseClaudeJson + stripJsonEcho. |
| Global messages array for Phase 1 chat | Per-node nodeChats Record for Phase 3 | Keyed by nodeId. Session-only (not persisted). |
| ForgePage stub (placeholder) | ForgePage full implementation | Two-column layout with ForgeNodePanel + ForgeChat. |

---

## Open Questions

1. **safeParseClaudeJson uses `indexOf` (first `{`), but nodeComplete suffix is at the END of the reply**
   - What we know: The existing `safeParseClaudeJson` finds the FIRST `{` in the text. If Claude produces any intermediate text mentioning JSON-like syntax before the suffix, the extraction could grab the wrong range.
   - What's unclear: How reliable is Claude at putting the suffix last?
   - Recommendation: Write a dedicated local extraction function for node-chat that searches from `lastIndexOf('{')` rather than `indexOf('{')`. This is a 5-line addition, more robust than modifying the shared utility.

2. **ForgePage null-node guard: navigate or render error state?**
   - What we know: D-11 says on confirm → navigate('/'). The stub already calls `navigate('/')` on back.
   - What's unclear: If prdTree is null (fresh app load, navigated directly to /forge/X), should we render an error or silently redirect?
   - Recommendation: Silent redirect to '/' is correct — no prdTree means no valid forge session. `if (!node) { navigate('/'); return null }` is sufficient.

3. **messages prop passed to ForgeChat vs reading nodeChats inside ForgeChat**
   - What we know: FORG-02 says components receive node context via props. D-17 says ForgeChat props include `messages`.
   - What's unclear: Should `ForgeChat` ever call `appendNodeMessage` directly, or only call `onSend`?
   - Recommendation: ForgeChat calls `onSend(text)` — a callback that ForgePage provides. ForgePage owns all store mutations. ForgeChat never touches the store. This satisfies FORG-02 strictly.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 3 has no new external dependencies. All tools (Node.js, npm, Anthropic API via existing server proxy) were confirmed available in Phase 1.

---

## Validation Architecture

`workflow.nyquist_validation` is explicitly `false` in `.planning/config.json`. This section is skipped.

---

## Sources

### Primary (HIGH confidence)
- `src/store/appStore.ts` — Current store shape, STORAGE_VERSION=4, partialize pattern, existing action patterns
- `server/index.ts` — `/api/chat` implementation (lines 855-887), `safeParseClaudeJson` (lines 163-181), `stripJsonEcho` (lines 183-186), `textFromClaudeContent` (lines 156-161), `extractText` (lines 45-48)
- `src/lib/api.ts` — `requestJson<T>` helper, `sendChatMessage` pattern to follow
- `src/components/chat/ChatPanel.tsx` — Loading indicator (three bouncing dots), error banner pattern, message rendering
- `src/types/chat.ts` — `ChatMessage` type (role + content: string | ContentBlock[])
- `src/types/prdNode.ts` — `PrdNode.status: 'pending' | 'done'`, `PrdTree` type
- `src/pages/ForgePage.tsx` — Existing stub with `useParams`, `useLocation` already imported
- `src/index.css` — `active-glow`, `node-glow`, `blueprint-grid`, `animate-fade-in` class definitions
- `stitch/main/Image 2.html` — Forge Blueprint color tokens, header height h-16 px-lg, badge patterns
- `.planning/config.json` — `nyquist_validation: false`, `commit_docs: true`

### Secondary (MEDIUM confidence)
- `src/components/upload/TreeSummary.tsx` — ID badge: `text-code-sm text-on-primary-container` pattern
- `src/components/map/TopAppBar.tsx` — Header layout: `h-16 px-lg flex justify-between items-center bg-surface border-b border-outline-variant z-20 shrink-0`

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already in project, no new dependencies
- Architecture patterns: HIGH — /api/node-chat follows /api/chat exactly; store additions are additive; component patterns follow existing ChatPanel/TopAppBar
- Pitfalls: HIGH — identified from direct code inspection of safeParseClaudeJson, store partialize, React StrictMode behavior
- Store migration risk: HIGH (LOW risk) — session-only field, no version bump needed, verified from partialize source

**Research date:** 2026-05-27
**Valid until:** 2026-06-27 (stable codebase, no fast-moving dependencies)
