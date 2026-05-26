<!-- GSD:project-start source:PROJECT.md -->
## Project

**GameUX PromptForge — PRD 文档拆解导图**

GameUX PromptForge 是一个面向游戏策划和交互设计师的桌面工具，用于将大型PRD文档自动拆解为可交互的思维导图，并对每个UI交互节点进行AI辅助的需求打磨，最终导出一套完整的交互设计spec文档。

**Core Value:** **将模糊的PRD文档转化为精确的、经过逐节点确认的交互设计规格**——用户上传一份大文档，经过结构化拆解和逐项打磨后，获得可直接交付给开发的详细spec文件夹。

### Constraints

- **交付形式**: 先Web版开发验证，后续包装Tauri桌面应用
- **技术栈**: 保持现有 React + Vite + Tailwind + Zustand + Express 栈
- **AI后端**: 继续使用Anthropic Claude API（通过本地Express代理）
- **设计规范**: 严格遵循 stitch/ 目录中的设计稿和 "Forge Blueprint" 设计系统
- **单文档**: 一次只处理一份PRD，不做并行管理
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript (latest via `typescript` package) - All frontend and server code
- Rust - Tauri desktop shell (compiled, no direct editing needed)
- CSS - `src/index.css` (global resets and custom animations only; all component styles use Tailwind)
## Runtime
- Node.js (version not pinned - no `.nvmrc` or `.node-version`)
- npm
- Lockfile: `package-lock.json` present
## Frameworks
- React (latest) - Component model; no router, single-page no-nav app
- Vite (latest) - Dev server on `http://127.0.0.1:5173`, production bundler
- Zustand ^5.0.13 with `persist` middleware - single global store persisted to `localStorage` under key `gameux-promptforge-state` at version `3`
- Tailwind CSS ^3.4.17 - utility-first; extensive custom design tokens in `tailwind.config.js`
- PostCSS + Autoprefixer (devDependencies)
- Tauri ^2.11.2 (CLI) / ^2.11.0 (API) - wraps the Vite app as a native desktop window
- Window: 1440×900, resizable, CSP disabled (`"csp": null`)
- Plugins used: `@tauri-apps/plugin-dialog` ^2.7.1 (save dialog), `@tauri-apps/plugin-fs` ^2.5.1 (file write)
- Express ^5.2.1 - local HTTP proxy on port 8787 (default, overridable via `LOCAL_PROXY_PORT`)
- `tsx` ^4.22.3 - runs the TypeScript server directly without compile step
- `concurrently` ^9.2.1 - runs server + client dev processes together
- `tsc -b && vite build` - production frontend build
- `tsx watch server/index.ts` - dev server with hot reload
## Key Dependencies
- `@anthropic-ai/sdk` ^0.97.1 - Claude API client; used only in `server/index.ts`; requires `ANTHROPIC_API_KEY` env var
- `zustand` ^5.0.13 - entire app state; loss of this breaks all persistence and cross-component communication
- `@tauri-apps/plugin-fs` ^2.5.1 - only mechanism for writing files to disk (markdown export)
- `cors` ^2.8.6 - Express CORS, origin-locked to `http://127.0.0.1:5173` and `http://localhost:5173`
- `dotenv` ^17.4.2 - loaded from both root `.env` and `server/.env`
- `express` ^5.2.1 - Note: Express v5 (not v4); error handler uses four-arg signature
## Configuration
- Root `.env` and/or `server/.env` (both loaded by `server/index.ts`)
- Required: `ANTHROPIC_API_KEY`
- Optional: `ANTHROPIC_BASE_URL`, `CLAUDE_MODEL` (defaults to `claude-sonnet-4-6`), `LOCAL_PROXY_PORT` (defaults to `8787`), `COCOS_RAG_SSE_URL`, `COCOS_RAG_PROXY_SCRIPT`, `APPDATA`
- `tsconfig.json` - composite project references to `tsconfig.app.json` (frontend) and `tsconfig.node.json` (server)
- `tailwind.config.js` - extensive design token extensions (colors, spacing, typography, border-radius)
- `src-tauri/tauri.conf.json` - Tauri app config (product name, window size, bundle targets)
- `vite.config.*` - not read in this analysis; standard Vite + React plugin setup assumed
## Platform Requirements
- Node.js + npm
- Python + `uv` runtime required on PATH for Cocos RAG MCP proxy (`uv run <script>`)
- Rust toolchain required only for `tauri:dev` / `tauri:build` commands
- Windows-specific env paths hardcoded in `tauri:dev:windows` script (`RUSTUP_HOME`, `CARGO_HOME`)
- Tauri desktop bundle (targets: all) via `npx tauri build`
- Express proxy must run as a separate process; not bundled into the Tauri binary
- App identifier: `com.gameux.promptforge`
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- All AI calls are proxied through `server/index.ts`; the frontend never calls Anthropic directly
- Global state is a single Zustand store with `persist` middleware; components read slices via selectors
- The "requirement" object (`UXRequirementState`) is the central data model - the AI incrementally fills it through conversation
- `AppShell` is the only orchestrator; it owns async side-effects (prototype generation, export). Child components receive props or read the store directly
## Layers
- Purpose: Wraps the web app as a native window; provides native file-save dialog and filesystem write
- Location: `src-tauri/`
- Contains: Rust code, `tauri.conf.json`, build artifacts
- Depends on: The compiled Vite `dist/` bundle
- Used by: End user OS; enables `src/lib/download.ts`
- Purpose: React SPA rendered in the Tauri webview
- Location: `src/`
- Contains: Components, store, types, lib utilities, data files
- Depends on: Local Express proxy at `settings.proxyBaseUrl` (default `http://127.0.0.1:8787`)
- Used by: Tauri webview
- Purpose: Bridges the frontend to the Anthropic Claude API and Cocos RAG MCP service; handles all secret management
- Location: `server/index.ts`
- Contains: Express routes, Claude agentic loop, state normalization, MCP subprocess management
- Depends on: `ANTHROPIC_API_KEY`, optionally `COCOS_RAG_SSE_URL` and `uv` Python runtime
- Used by: Frontend `src/lib/api.ts`
## Component Tree
```
```
## Data Flow
- Zustand `persist` middleware serializes `requirement`, `messages`, `latestRag`, `settings` to `localStorage`
- `prototypeHtml` is intentionally excluded from persistence (not in `partialize`)
- Storage version is `3`; version mismatches will wipe persisted state silently
## Key Abstractions
- Purpose: The central "slot-filling" model the AI populates. Has four primary slots (`trigger_condition`, `sequence_rules`, `asset_dependencies`, `engine_constraints`), a `ui_components` tree, `completion_rate` (0-100), per-slot `slot_confidence`, `missing_reasons`, `next_question`, and `suggested_answers`
- Defined: `src/types/uxRequirement.ts`
- Filled by: AI responses via `state_patch` JSON embedded in Claude replies
- Purpose: Represents a single chat turn; content can be `string` (text only) or `ContentBlock[]` (mixed text + base64 images)
- Defined: `src/types/chat.ts`
- Images are base64-encoded in the browser and passed through the proxy directly to the Anthropic API
- Purpose: User-configurable runtime settings: `projectName`, `proxyBaseUrl`, `defaultRagQuery`
- Defined: `src/types/chat.ts`; defaults in `src/data/defaultSettings.ts`
- Persisted to localStorage; editable in `SettingsPanel`
- Purpose: Display primitive for a single requirement slot (title, body, confidence bar, missing reason, optional inline input)
- Defined: `src/components/state/StateCard.tsx`
- Three tone variants: `complete` (green), `missing` (red/dashed), `info` (blue)
## Entry Points
- Location: `src/main.tsx`
- Triggers: Vite dev server loads `index.html`, which loads `src/main.tsx` → `ReactDOM.createRoot`
- Location: `server/index.ts`
- Triggers: `npm run dev:server` → `tsx watch server/index.ts`; listens on `127.0.0.1:8787`
- Location: `src-tauri/tauri.conf.json`
- Triggers: `npx tauri dev` or `npx tauri build`; `beforeDevCommand: npm run dev` starts both processes
## Error Handling
- `ChatPanel` catches `sendChatMessage` failures, sets `error` state (shows red banner), and appends a fallback assistant message
- `AppShell.handleExportPrompt()` catches and calls `alert()` - inconsistent with rest of UI
- `src/lib/api.ts` throws `Error` with message from server JSON `error` field or HTTP status
- Server uses Express v5 four-arg error handler at the end of `server/index.ts` (lines 713-717)
- `safeParseClaudeJson()` has a two-candidate fallback parser so malformed Claude JSON doesn't hard-crash the server
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
