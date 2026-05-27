---
phase: 03-deep-forge
plan: 01
status: complete
wave: 1
completed: 2026-05-27
---

# Summary: Store + Server + API Client Extensions

## One-liner
Extended Zustand store with per-node chat state, added /api/node-chat Express endpoint with Claude context injection, and exported sendNodeChatMessage() from api.ts.

## What was built
- **`src/store/appStore.ts`** (modified) — added:
  - `nodeChats: Record<string, ChatMessage[]>` field (initialized to `{}`) in interface + initial state
  - `appendNodeMessage(nodeId, msg)`, `clearNodeChat(nodeId)`, `updateNodeStatus(nodeId, status)` actions
  - Fixed pre-existing `partialize` TypeScript error (added `migrate: (): unknown =>` annotation to break incorrect type inference)
  - STORAGE_VERSION unchanged at 4; `nodeChats` NOT in partialize (session-only per PRST-02)
- **`server/index.ts`** (modified) — added:
  - `NodeChatRequest` interface (`{ nodeId, messages, tree }`)
  - `POST /api/node-chat` route: validates inputs, injects target node + parent context into system prompt, calls `anthropic.messages.create()` directly (no agentic loop), extracts `nodeComplete` boolean via `lastIndexOf('{')` suffix parser
- **`src/lib/api.ts`** (modified) — added:
  - `NodeChatResponse` interface (`{ reply: string, nodeComplete: boolean }`)
  - `sendNodeChatMessage(baseUrl, nodeId, messages, tree)` function

## Key decisions applied
- D-04: nodeChats NOT persisted (session-only)
- D-07/D-13: POST body `{ nodeId, messages, tree }`, response `{ reply, nodeComplete }`
- D-14: parent node context auto-injected when `parentId` exists
- D-15: Chinese, ≤8 lines, JSON suffix `{"nodeComplete": true}` when ready
- RESEARCH Pitfall 1: Use `lastIndexOf('{')` not `indexOf` for nodeComplete suffix extraction

## Verification
- `npx tsc -p tsconfig.app.json --noEmit` exits 0
- `npx tsc -p tsconfig.node.json --noEmit` exits 0
- `nodeChats` appears in interface, initial state, and 2 actions — NOT in partialize
- `STORAGE_VERSION = 4` unchanged
- `/api/node-chat` route registered, uses `lastIndexOf` not `safeParseClaudeJson`
