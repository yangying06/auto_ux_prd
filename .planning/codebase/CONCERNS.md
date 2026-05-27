# Codebase Concerns

**Analysis Date:** 2026-05-26

## Tech Debt

**Express body size limit blocks large image attachments:**
- Issue: `express.json({ limit: '1mb' })` in `server/index.ts` line 543. A single high-res image base64-encoded can easily exceed 1 MB; multiple attachments will certainly breach it.
- Files: `server/index.ts`
- Impact: Users attaching large screenshots or multiple images get a hard 413 error from Express that surfaces as a generic proxy error in `ChatPanel`
- Fix approach: Increase limit to `'10mb'` or add multipart form upload; currently the frontend also stores image base64 in the Zustand `messages` array which gets persisted to localStorage, creating a secondary issue

**Image base64 stored in localStorage via Zustand persist:**
- Issue: `messages` array (which can contain base64 image `ContentBlock[]`) is included in the Zustand `partialize` and written to `localStorage`. A few image messages can exceed the ~5 MB localStorage quota.
- Files: `src/store/appStore.ts` (line 81-87)
- Impact: localStorage quota errors cause silent persist failures; on next reload the entire state may be wiped (storage version mismatch behavior)
- Fix approach: Exclude image blocks from persistence (store only text content of messages), or strip image data before persist

**`prototypeHtml` excluded from persistence but reset loses prototype:**
- Issue: `prototypeHtml` is not in `partialize` so it is wiped on page reload. `resetSession` also clears it. There is no way to recover a generated prototype without re-generating.
- Files: `src/store/appStore.ts` (line 75, 81-87)
- Impact: Minor UX friction - user must click "Generate Prototype" again after any reload
- Fix approach: Include `prototypeHtml` in persist partialize (but note this compounds the localStorage size issue)

**No lockfile version pinning for runtime dependencies:**
- Issue: `package.json` uses `"react": "latest"`, `"vite": "latest"`, `"typescript": "latest"` etc. - no specific versions pinned for production-critical packages.
- Files: `package.json`
- Impact: `npm install` on a new machine may pull different major/minor versions; breaking changes in React or Vite could silently break the build
- Fix approach: After confirming current working versions, replace `latest` with exact version strings

**MCP proxy subprocess spawned per request:**
- Issue: `callMcpTool()` in `server/index.ts` (line 420) spawns a new `uv run` Python process for every tool call. Each spawn includes an 8-second timeout waiting for the SSE endpoint to be ready.
- Files: `server/index.ts`
- Impact: RAG tool calls add 2-10 seconds latency per invocation; heavy chats with multiple tool calls are noticeably slow; a process leak is possible if `proxyProcess.kill()` in the `finally` block fails
- Fix approach: Keep a long-lived MCP proxy process and reuse it across requests, or cache connections

**`extractText` duplicated across files:**
- Issue: A function with signature `function extractText(content: string | ContentBlock[]): string` exists independently in both `AppShell.tsx` (line 10-13) and `server/index.ts` (line 33-36).
- Files: `src/components/layout/AppShell.tsx`, `server/index.ts`
- Impact: Low risk now; a bug fix must be applied in two places
- Fix approach: Move the client-side version to `src/lib/utils.ts` and import it

**`StateCard` path input is non-functional:**
- Issue: `StateCard` renders an `<input>` when `inputPlaceholder` prop is set (for missing asset paths), but it has no `onChange`, no value binding, and no submit action. It is display-only.
- Files: `src/components/state/StateCard.tsx` (lines 75-82)
- Impact: Users may attempt to type a path there expecting it to update state; nothing happens
- Fix approach: Either remove the input or wire it to a callback prop that sends a chat message or patches the requirement

## Security Considerations

**CSP disabled in Tauri:**
- Risk: `"csp": null` in `src-tauri/tauri.conf.json` means the webview has no Content Security Policy. The `<iframe sandbox="allow-scripts">` for prototype preview allows script execution inside the prototype, but the broader webview is unprotected.
- Files: `src-tauri/tauri.conf.json`
- Current mitigation: The prototype iframe uses `sandbox="allow-scripts"` which blocks form submission, popups, and same-origin access. CORS on the proxy server is locked to localhost.
- Recommendations: Define a restrictive CSP for the Tauri app; keep the iframe sandbox as-is

**API key in environment only (correct), but proxy has no auth:**
- Risk: The local Express proxy at port 8787 has no authentication. Any process on the local machine can call it and consume the user's Anthropic API credits.
- Files: `server/index.ts` (CORS is the only guard, lines 542)
- Current mitigation: CORS origin lock to `127.0.0.1:5173` / `localhost:5173` only (browser-enforced, not process-enforced)
- Recommendations: Add a per-session token header for defense in depth; acceptable risk for a local dev tool

## Performance Bottlenecks

**Claude loop is synchronous/blocking per request:**
- Problem: `runClaudeRequirementLoop()` in `server/index.ts` is a sequential `while(true)` loop making blocking Claude API calls. Express handles one chat request at a time without streaming.
- Files: `server/index.ts` (line 328)
- Cause: No streaming (`stream: true`) - each full response is awaited before returning
- Improvement path: Use Claude streaming API (`stream: true`) and pipe SSE events to the frontend for real-time response display

**Large `messages` array passed on every chat turn:**
- Problem: The full `messages` array is serialized and POSTed to the proxy on every turn, growing unbounded through the session.
- Files: `src/lib/api.ts` (line 35-38), `server/index.ts` (line 572)
- Cause: The entire conversation history is re-sent to maintain context; no server-side session state
- Improvement path: Implement server-side session state with a session ID, or summarize older messages

## Fragile Areas

**`safeParseClaudeJson` fallback behavior:**
- Files: `server/index.ts` (lines 151-169)
- Why fragile: If Claude returns malformed JSON, the fallback `stripJsonEcho` returns only text before the first `{`. This silently produces an empty `state_patch`, meaning the requirement never updates for that turn without any visible error to the user.
- Safe modification: Always log parse failures server-side so they can be diagnosed
- Test coverage: No tests exist

**Auto-prototype trigger in `AppShell`:**
- Files: `src/components/layout/AppShell.tsx` (lines 31-38)
- Why fragile: The `useEffect` checks `lastAutoGenRate.current < 60` vs the new rate. It uses `// eslint-disable-next-line react-hooks/exhaustive-deps` to suppress the exhaustive deps warning, meaning `handleGeneratePrototype` is captured as a stale closure. If `settings.proxyBaseUrl` changes between renders, the auto-gen call could use the old URL.
- Safe modification: Include `handleGeneratePrototype` in the dependency array or move the ref comparison to a different pattern

**Zustand storage version migration:**
- Files: `src/store/appStore.ts` (line 21: `STORAGE_VERSION = 3`)
- Why fragile: No `migrate` function is defined. When `STORAGE_VERSION` is bumped, Zustand silently discards all persisted state (messages, requirement, settings) rather than migrating it.
- Safe modification: Add a `migrate` callback to the persist config before bumping the version

## Missing Critical Features

**No streaming chat responses:**
- Problem: The UI shows a loading spinner while waiting for the full Claude response (which can take 5-20 seconds). Users have no visibility into partial output.
- Blocks: Good UX for longer AI completions

**No session management / history:**
- Problem: All history is in a single flat array in localStorage. There is no way to save multiple requirement sessions, name them, or switch between them.
- Blocks: Workflows where a designer works on multiple UX requirements

**StateCard path input is wired to nothing:**
- Problem: The asset path `<input>` in `StateCard` is cosmetic only (see Tech Debt above)
- Blocks: Inline path editing flow that the UI implies is possible

## Test Coverage Gaps

**No tests at all:**
- What's not tested: Every module in the codebase
- Files: All of `src/`, `server/index.ts`
- Risk: Regressions in state normalization logic (`normalizeStatePatch`, `normalizeStatePatch`), JSON parsing (`safeParseClaudeJson`), and the Claude tool loop are entirely undetected
- Priority: High for `server/index.ts` normalization functions; medium for component render logic

---

*Concerns audit: 2026-05-26*
