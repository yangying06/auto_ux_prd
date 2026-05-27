---
phase: 04-export
status: Ready for planning
gathered: 2026-05-27
---

# Phase 4: Export - Context

**Gathered:** 2026-05-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can trigger a zip export of all completed leaf nodes as Markdown spec documents. The export is gated on 100% leaf node completion. Each leaf node becomes one `.md` file; the zip folder structure mirrors the tree hierarchy. The user receives a browser download dialog.

Scope: Export button in TopAppBar, server `/api/export-zip` endpoint that generates Markdown per node and packages into a zip, browser download via Blob URL. No AI generation per node — structured template from existing PrdNode fields.

</domain>

<decisions>
## Implementation Decisions

### Export Gate & Button Placement
- **D-01:** Add "导出 Spec" button to `TopAppBar` (right side, next to "Upload PRD"). Button is always rendered but `disabled` when not all leaf nodes are `status: 'done'`.
- **D-02:** Leaf nodes are nodes where `node.children.length === 0` in `prdTree`. Non-leaf (root/module) nodes are excluded from the gate check and from spec generation.
- **D-03:** Disabled state: `opacity-40 cursor-not-allowed`; tooltip/title text "所有节点完成后才能导出". Active state: uses `bg-secondary-container text-on-secondary-container` styling consistent with other TopAppBar buttons.
- **D-04:** Export gate check performed in TopAppBar via a computed value from prdTree passed as a prop from MapPage. TopAppBar receives `canExport: boolean` prop (MapPage computes it).

### Zip Delivery
- **D-05:** Server endpoint: `POST /api/export-zip`. Request body: `{ tree: Record<string, PrdNode> }`. Response: binary `application/zip` with `Content-Disposition: attachment; filename="spec-export.zip"`.
- **D-06:** Client triggers download via `fetch()` → `.blob()` → `URL.createObjectURL()` → programmatic `<a>` click → `URL.revokeObjectURL()`. Works in browser AND Tauri webview (both support Blob URLs).
- **D-07:** Add `exportSpec(baseUrl, tree)` function to `src/lib/api.ts` — returns a `Blob` (not JSON). Use raw `fetch()` directly (bypasses `requestJson<T>` which assumes JSON).

### Spec Document Format
- **D-08:** Each leaf node generates one Markdown file. No Claude API call — structured template only. Template:
  ```markdown
  # {node.label}

  **ID:** {node.id}
  **Type:** {node.type}
  **Status:** 已完成

  ## 需求摘要

  {node.summary}

  ## 详细内容

  {node.content}

  {if node.techNotes:}
  ## 技术备注

  {node.techNotes}
  {endif}
  ```
- **D-09:** File naming: `{node.id}-{sanitized_label}.md` where sanitized_label replaces spaces/special chars with `-` and truncates to 40 chars. Example: `CE-01-主界面入口按钮.md`.

### Zip Package & Folder Structure
- **D-10:** Use `fflate` npm package on the server for zip creation. Install as a `dependency` (not devDependency). `fflate` is pure JS, ~7KB, zero transitive deps, works in Node.js.
- **D-11:** Zip folder structure mirrors the tree: each non-leaf node becomes a folder named `{node.id}-{sanitized_label}/`. Leaf nodes are placed inside their parent's folder. Root node becomes the top-level folder. Example:
  ```
  spec-export.zip
  └── ROOT-01-角色扮演战斗系统/
      ├── MOD-01-战斗模块/
      │   ├── CE-01-主界面入口按钮.md
      │   └── CE-02-角色选择界面.md
      └── MOD-02-道具系统/
          └── IT-01-道具背包界面.md
  ```
- **D-12:** Path construction: walk from leaf to root via `parentId` chain, reverse to get root→leaf path. Use `node.id` only (not label) for folder names to keep paths safe: `{nodeId}/`.

### TopAppBar Extension
- **D-13:** `TopAppBar` props change: add `canExport?: boolean` and `onExport?: () => void`. Both optional for backwards compatibility. Button only renders when `onExport` is provided.
- **D-14:** Export loading state: TopAppBar receives `isExporting?: boolean`. When true, button shows spinner icon + "生成中..." label. MapPage manages `isExporting` state during the fetch.

### Claude's Discretion
- Exact error handling UX when export fails (e.g., server error banner vs silent toast — reuse existing error patterns)
- Progress feedback during zip generation (the POST is synchronous, should complete in under 1s for typical PRD sizes)
- Whether to show a success notification after download initiates

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design System
- `stitch/main/Image 2.html` — Forge Blueprint color tokens, button styles, TopAppBar reference
- `stitch/main/Image 3.markdown` — Full design token definitions

### Existing Code to Extend
- `src/components/map/TopAppBar.tsx` — Add export button here; extend props interface
- `src/pages/MapPage.tsx` — Compute canExport, pass to TopAppBar, handle onExport callback
- `src/lib/api.ts` — Add `exportSpec()` function (returns Blob, not JSON)
- `server/index.ts` — Add `/api/export-zip` route following existing patterns
- `src/types/prdNode.ts` — PrdNode type (id, parentId, label, summary, content, techNotes, type, status, children)

### Phase Patterns to Follow
- `.planning/phases/03-deep-forge/03-CONTEXT.md` — D-13 pattern for server endpoint request/response shape
- `.planning/phases/02-mindmap-preview/02-CONTEXT.md` — TopAppBar layout and props pattern

### Requirements
- `.planning/REQUIREMENTS.md` §EXPT-01 through EXPT-04 — all Phase 4 acceptance criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/download.ts` — `downloadMarkdown(filename, content)` using Tauri fs — NOT reusable for web zip download; Phase 4 uses Blob URL approach instead
- `src/components/map/TopAppBar.tsx` — Existing header component with `onUploadNew` prop pattern; extend with `canExport`, `onExport`, `isExporting` props
- `src/lib/api.ts` — `requestJson<T>` helper — not suitable for binary response; new `exportSpec()` uses raw `fetch()` + `.blob()`
- `server/index.ts` — existing `/api/export-prompt` shows Claude-based Markdown generation pattern; Phase 4 uses template-based generation (no Claude call)

### Established Patterns
- Server: `app.post('/api/...', async (req, res) => {...})` — follow for `/api/export-zip`
- API client: module-level exported functions in `src/lib/api.ts`
- MapPage: passes handlers and computed values as props to child components (same for `canExport`/`onExport`)
- TopAppBar already has a right-side button area (`onUploadNew` button) — export button goes alongside it

### Integration Points
- `MapPage.tsx` stage=`'map'` branch: already uses `prdTree` — compute `canExport = Object.values(prdTree).filter(n => n.children.length === 0).every(n => n.status === 'done')`
- `TopAppBar.tsx` right side: add export button next to "Upload PRD" button
- `server/index.ts`: add route after `/api/node-chat` route

### Zip Library
- `fflate` not yet installed — must `npm install fflate` as part of plan execution
- Node.js has no built-in ZIP format writer (only zlib/gzip) — `fflate` is the minimal correct choice

</code_context>

<specifics>
## Specific Ideas

- The path construction for zip folder structure: use `node.id` only for folder names (not label) to avoid filesystem-unsafe characters. Example folder path for leaf CE-01 with parent MOD-01 under ROOT-01: `ROOT-01/MOD-01/CE-01-sanitized-label.md`
- The Blob URL download pattern:
  ```typescript
  const blob = await exportSpec(settings.proxyBaseUrl, prdTree)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'spec-export.zip'
  a.click()
  URL.revokeObjectURL(url)
  ```
- `fflate` zip API (server-side):
  ```typescript
  import { zipSync } from 'fflate'
  const files: Record<string, Uint8Array> = {}
  files['path/to/file.md'] = Buffer.from(content, 'utf-8')
  const zipped = zipSync(files)
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', 'attachment; filename="spec-export.zip"')
  res.end(Buffer.from(zipped))
  ```

</specifics>

<deferred>
## Deferred Ideas

- PRST-01: Tauri file system persistence (saving zip to user-chosen folder via Tauri dialog) — v2; Phase 4 uses browser Blob URL download which also works in Tauri webview
- AI-generated spec documents (Claude synthesizes chat history + node data per leaf) — v2 enhancement; Phase 4 uses structured template for reliability and speed
- Export progress UI (per-node generation status) — v2; synchronous single-request approach is fast enough for typical PRD sizes
- Partial export (export only selected nodes) — v2; Phase 4 gates on full completion

</deferred>

---

*Phase: 04-export*
*Context gathered: 2026-05-27*
