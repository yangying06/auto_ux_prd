# Technology Stack

**Analysis Date:** 2026-05-26

## Languages

**Primary:**
- TypeScript (latest via `typescript` package) - All frontend and server code
- Rust - Tauri desktop shell (compiled, no direct editing needed)

**Secondary:**
- CSS - `src/index.css` (global resets and custom animations only; all component styles use Tailwind)

## Runtime

**Environment:**
- Node.js (version not pinned - no `.nvmrc` or `.node-version`)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present

## Frameworks

**Core Frontend:**
- React (latest) - Component model; no router, single-page no-nav app
- Vite (latest) - Dev server on `http://127.0.0.1:5173`, production bundler

**State Management:**
- Zustand ^5.0.13 with `persist` middleware - single global store persisted to `localStorage` under key `gameux-promptforge-state` at version `3`

**Styling:**
- Tailwind CSS ^3.4.17 - utility-first; extensive custom design tokens in `tailwind.config.js`
- PostCSS + Autoprefixer (devDependencies)

**Desktop Shell:**
- Tauri ^2.11.2 (CLI) / ^2.11.0 (API) - wraps the Vite app as a native desktop window
- Window: 1440×900, resizable, CSP disabled (`"csp": null`)
- Plugins used: `@tauri-apps/plugin-dialog` ^2.7.1 (save dialog), `@tauri-apps/plugin-fs` ^2.5.1 (file write)

**Backend/Proxy:**
- Express ^5.2.1 - local HTTP proxy on port 8787 (default, overridable via `LOCAL_PROXY_PORT`)
- `tsx` ^4.22.3 - runs the TypeScript server directly without compile step
- `concurrently` ^9.2.1 - runs server + client dev processes together

**Build/Dev:**
- `tsc -b && vite build` - production frontend build
- `tsx watch server/index.ts` - dev server with hot reload

## Key Dependencies

**Critical:**
- `@anthropic-ai/sdk` ^0.97.1 - Claude API client; used only in `server/index.ts`; requires `ANTHROPIC_API_KEY` env var
- `zustand` ^5.0.13 - entire app state; loss of this breaks all persistence and cross-component communication
- `@tauri-apps/plugin-fs` ^2.5.1 - only mechanism for writing files to disk (markdown export)

**Infrastructure:**
- `cors` ^2.8.6 - Express CORS, origin-locked to `http://127.0.0.1:5173` and `http://localhost:5173`
- `dotenv` ^17.4.2 - loaded from both root `.env` and `server/.env`
- `express` ^5.2.1 - Note: Express v5 (not v4); error handler uses four-arg signature

## Configuration

**Environment:**
- Root `.env` and/or `server/.env` (both loaded by `server/index.ts`)
- Required: `ANTHROPIC_API_KEY`
- Optional: `ANTHROPIC_BASE_URL`, `CLAUDE_MODEL` (defaults to `claude-sonnet-4-6`), `LOCAL_PROXY_PORT` (defaults to `8787`), `COCOS_RAG_SSE_URL`, `COCOS_RAG_PROXY_SCRIPT`, `APPDATA`

**Build:**
- `tsconfig.json` - composite project references to `tsconfig.app.json` (frontend) and `tsconfig.node.json` (server)
- `tailwind.config.js` - extensive design token extensions (colors, spacing, typography, border-radius)
- `src-tauri/tauri.conf.json` - Tauri app config (product name, window size, bundle targets)
- `vite.config.*` - not read in this analysis; standard Vite + React plugin setup assumed

## Platform Requirements

**Development:**
- Node.js + npm
- Python + `uv` runtime required on PATH for Cocos RAG MCP proxy (`uv run <script>`)
- Rust toolchain required only for `tauri:dev` / `tauri:build` commands
- Windows-specific env paths hardcoded in `tauri:dev:windows` script (`RUSTUP_HOME`, `CARGO_HOME`)

**Production:**
- Tauri desktop bundle (targets: all) via `npx tauri build`
- Express proxy must run as a separate process; not bundled into the Tauri binary
- App identifier: `com.gameux.promptforge`

---

*Stack analysis: 2026-05-26*
