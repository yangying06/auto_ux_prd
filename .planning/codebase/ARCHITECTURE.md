# Architecture

**Analysis Date:** 2026-05-26

## Pattern Overview

**Overall:** Two-process desktop application - Tauri-wrapped React SPA (frontend) + local Express proxy server (backend). No routing; single full-screen layout.

**Key Characteristics:**
- All AI calls are proxied through `server/index.ts`; the frontend never calls Anthropic directly
- Global state is a single Zustand store with `persist` middleware; components read slices via selectors
- The "requirement" object (`UXRequirementState`) is the central data model - the AI incrementally fills it through conversation
- `AppShell` is the only orchestrator; it owns async side-effects (prototype generation, export). Child components receive props or read the store directly

## Layers

**Desktop Shell:**
- Purpose: Wraps the web app as a native window; provides native file-save dialog and filesystem write
- Location: `src-tauri/`
- Contains: Rust code, `tauri.conf.json`, build artifacts
- Depends on: The compiled Vite `dist/` bundle
- Used by: End user OS; enables `src/lib/download.ts`

**Frontend Application:**
- Purpose: React SPA rendered in the Tauri webview
- Location: `src/`
- Contains: Components, store, types, lib utilities, data files
- Depends on: Local Express proxy at `settings.proxyBaseUrl` (default `http://127.0.0.1:8787`)
- Used by: Tauri webview

**Local Proxy Server:**
- Purpose: Bridges the frontend to the Anthropic Claude API and Cocos RAG MCP service; handles all secret management
- Location: `server/index.ts`
- Contains: Express routes, Claude agentic loop, state normalization, MCP subprocess management
- Depends on: `ANTHROPIC_API_KEY`, optionally `COCOS_RAG_SSE_URL` and `uv` Python runtime
- Used by: Frontend `src/lib/api.ts`

## Component Tree

```
App                             src/App.tsx
└── AppShell                    src/components/layout/AppShell.tsx
    ├── ChatPanel               src/components/chat/ChatPanel.tsx
    ├── StateCanvas             src/components/state/StateCanvas.tsx
    │   ├── RequirementTree     (inline component in StateCanvas.tsx)
    │   ├── StateCard (×4-6)    src/components/state/StateCard.tsx
    │   └── PrototypeBoard      src/components/state/PrototypeBoard.tsx
    └── SettingsPanel           src/components/layout/SettingsPanel.tsx
```

**Layout split:** `ChatPanel` is `w-[35%]` left column; `StateCanvas` is `w-[65%]` right panel. Fixed full-screen, no scroll on the outer container.

## Data Flow

**Chat Turn (happy path):**

1. User types in `ChatPanel` textarea, optionally attaches image files (read as base64 via `FileReader`)
2. `ChatPanel.handleSend()` appends user message to `messages` in store, calls `sendChatMessage()` from `src/lib/api.ts`
3. `src/lib/api.ts` POSTs `{ messages, requirementState }` to `POST /api/chat` on Express proxy
4. `server/index.ts` runs `runClaudeRequirementLoop()`: builds a single-user-turn context message (images + JSON state), calls Claude with the system prompt and `query_cocos_knowledge` tool; if Claude invokes the tool, spawns a `uv` subprocess MCP client, injects the result, and loops until `end_turn`
5. Server normalizes and returns `{ reply, statePatch, rag, usage }`
6. `ChatPanel` appends assistant reply to `messages`, calls `applyRequirementPatch(statePatch)` on the store
7. If `completion_rate` crosses 60%, `AppShell` `useEffect` auto-triggers `handleGeneratePrototype()`

**Prototype Generation:**

1. `AppShell.handleGeneratePrototype()` calls `generatePrototype(baseUrl, requirement)` (`POST /api/prototype`)
2. Server sends requirement state + ui_components tree to Claude with an HTML generation prompt
3. Returns `{ html }` - a self-contained HTML string with inline CSS/JS
4. `setPrototypeHtml(html)` stored in Zustand; `PrototypeBoard` renders it in a sandboxed `<iframe>`

**Export Final Prompt:**

1. `AppShell.handleExportPrompt()` calls `exportFinalPrompt(baseUrl, requirement, summary)` (`POST /api/export-prompt`)
2. Server asks Claude to generate a Cocos Creator 3.8.8 implementation design document as Markdown
3. Returns `{ markdown }`; displayed in a modal `<pre>` in `AppShell`
4. User can click "Download .md" → `downloadMarkdown()` in `src/lib/download.ts` uses Tauri dialog + fs plugins

**State Persistence:**
- Zustand `persist` middleware serializes `requirement`, `messages`, `latestRag`, `settings` to `localStorage`
- `prototypeHtml` is intentionally excluded from persistence (not in `partialize`)
- Storage version is `3`; version mismatches will wipe persisted state silently

## Key Abstractions

**UXRequirementState:**
- Purpose: The central "slot-filling" model the AI populates. Has four primary slots (`trigger_condition`, `sequence_rules`, `asset_dependencies`, `engine_constraints`), a `ui_components` tree, `completion_rate` (0-100), per-slot `slot_confidence`, `missing_reasons`, `next_question`, and `suggested_answers`
- Defined: `src/types/uxRequirement.ts`
- Filled by: AI responses via `state_patch` JSON embedded in Claude replies

**ChatMessage:**
- Purpose: Represents a single chat turn; content can be `string` (text only) or `ContentBlock[]` (mixed text + base64 images)
- Defined: `src/types/chat.ts`
- Images are base64-encoded in the browser and passed through the proxy directly to the Anthropic API

**AppSettings:**
- Purpose: User-configurable runtime settings: `projectName`, `proxyBaseUrl`, `defaultRagQuery`
- Defined: `src/types/chat.ts`; defaults in `src/data/defaultSettings.ts`
- Persisted to localStorage; editable in `SettingsPanel`

**StateCard:**
- Purpose: Display primitive for a single requirement slot (title, body, confidence bar, missing reason, optional inline input)
- Defined: `src/components/state/StateCard.tsx`
- Three tone variants: `complete` (green), `missing` (red/dashed), `info` (blue)

## Entry Points

**Frontend:**
- Location: `src/main.tsx`
- Triggers: Vite dev server loads `index.html`, which loads `src/main.tsx` → `ReactDOM.createRoot`

**Backend:**
- Location: `server/index.ts`
- Triggers: `npm run dev:server` → `tsx watch server/index.ts`; listens on `127.0.0.1:8787`

**Tauri:**
- Location: `src-tauri/tauri.conf.json`
- Triggers: `npx tauri dev` or `npx tauri build`; `beforeDevCommand: npm run dev` starts both processes

## Error Handling

**Strategy:** Errors are surfaced to the user inline; no global error boundary in React.

**Patterns:**
- `ChatPanel` catches `sendChatMessage` failures, sets `error` state (shows red banner), and appends a fallback assistant message
- `AppShell.handleExportPrompt()` catches and calls `alert()` - inconsistent with rest of UI
- `src/lib/api.ts` throws `Error` with message from server JSON `error` field or HTTP status
- Server uses Express v5 four-arg error handler at the end of `server/index.ts` (lines 713-717)
- `safeParseClaudeJson()` has a two-candidate fallback parser so malformed Claude JSON doesn't hard-crash the server

## Cross-Cutting Concerns

**Logging:** `console.log` in `server/index.ts` startup only; no structured logging anywhere

**Validation:** Server normalizes all Claude-generated state patches via `normalizeStatePatch()` before returning them; frontend trusts the normalized data

**Authentication:** No user auth. API key stored in server `.env`, never sent to the frontend. Frontend is `localhost`-only by CORS policy.

**Image Handling:** Images are read as base64 `data:` URLs in the browser (`FileReader`), the base64 `data` portion is stored in the message, and POSTed in the JSON body (1 MB Express limit). Large images can exceed this limit.

---

*Architecture analysis: 2026-05-26*
