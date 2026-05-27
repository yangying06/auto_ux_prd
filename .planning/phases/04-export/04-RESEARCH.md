# Phase 4: Export - Research

**Researched:** 2026-05-27
**Domain:** Browser Blob download, zip generation (fflate), Express binary response, React prop extension
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Export Gate & Button Placement**
- D-01: Add "导出 Spec" button to `TopAppBar` (right side, next to "Upload PRD"). Button is always rendered but `disabled` when not all leaf nodes are `status: 'done'`.
- D-02: Leaf nodes are nodes where `node.children.length === 0` in `prdTree`. Non-leaf nodes are excluded from the gate check and from spec generation.
- D-03: Disabled state: `opacity-40 cursor-not-allowed`; tooltip/title text "所有节点完成后才能导出". Active state: `bg-secondary-container text-on-secondary-container`.
- D-04: Export gate check performed in TopAppBar via a computed value from prdTree passed as a prop from MapPage. TopAppBar receives `canExport: boolean` prop (MapPage computes it).

**Zip Delivery**
- D-05: Server endpoint: `POST /api/export-zip`. Request body: `{ tree: Record<string, PrdNode> }`. Response: binary `application/zip` with `Content-Disposition: attachment; filename="spec-export.zip"`.
- D-06: Client triggers download via `fetch()` → `.blob()` → `URL.createObjectURL()` → programmatic `<a>` click → `URL.revokeObjectURL()`. Works in browser AND Tauri webview.
- D-07: Add `exportSpec(baseUrl, tree)` to `src/lib/api.ts` returning a `Blob`. Uses raw `fetch()` directly (not `requestJson<T>`).

**Spec Document Format**
- D-08: Each leaf node generates one Markdown file via structured template — NO Claude API call.
  Template fields: `node.label`, `node.id`, `node.type`, `node.summary`, `node.content`, optional `node.techNotes`.
- D-09: File naming: `{node.id}-{sanitized_label}.md` — sanitized_label replaces spaces/special chars with `-`, truncated to 40 chars.

**Zip Package & Folder Structure**
- D-10: Use `fflate` npm package on server. Install as a `dependency`. Pure JS, ~7KB, zero transitive deps.
- D-11: Zip folder structure mirrors the tree: each non-leaf node becomes a folder `{node.id}/`. Leaf nodes placed inside parent's folder. Root node = top-level folder.
- D-12: Path construction: walk leaf → root via `parentId`, reverse for root→leaf path. Use `node.id` only for folder names (filesystem-safe).

**TopAppBar Extension**
- D-13: `TopAppBar` props change: add `canExport?: boolean` and `onExport?: () => void`. Both optional for backwards compatibility. Button only renders when `onExport` is provided.
- D-14: Export loading state: TopAppBar receives `isExporting?: boolean`. When true, button shows spinner icon + "生成中..." label. MapPage manages `isExporting` state.

### Claude's Discretion

- Exact error handling UX when export fails (server error banner vs silent toast — reuse existing error patterns)
- Progress feedback during zip generation (POST is synchronous, should complete in under 1s for typical PRD sizes)
- Whether to show a success notification after download initiates

### Deferred Ideas (OUT OF SCOPE)

- PRST-01: Tauri file system persistence (saving zip to user-chosen folder via Tauri dialog) — v2
- AI-generated spec documents (Claude synthesizes chat history + node data per leaf) — v2
- Export progress UI (per-node generation status) — v2
- Partial export (export only selected nodes) — v2
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXPT-01 | 导出按钮在所有节点完成前保持disabled（门禁检查） | D-01, D-02, D-03, D-04: canExport prop computed in MapPage; TopAppBar applies disabled styling |
| EXPT-02 | 每个完成的叶子节点生成一份Markdown spec文档 | D-08, D-09: template-based generation in server handler, one file per leaf |
| EXPT-03 | 打包为zip压缩包供用户下载 | D-05, D-06, D-07, D-10: fflate on server + Blob URL download on client |
| EXPT-04 | Zip内目录结构对应树的层级结构 | D-11, D-12: parentId chain walk to build folder paths |
</phase_requirements>

---

## Summary

Phase 4 is a tightly scoped, no-AI, synchronous export feature. The implementation splits cleanly into three layers: (1) frontend gate logic in MapPage + TopAppBar, (2) a client-side Blob URL download function in `src/lib/api.ts`, and (3) a server-side `POST /api/export-zip` route that assembles Markdown files and packages them with `fflate`.

All decisions are fully locked in CONTEXT.md. No library research is required for core stack choices — `fflate` is the only new dependency (`npm install fflate`). The existing `requestJson<T>` helper cannot handle binary responses, so `exportSpec()` must use raw `fetch()` + `.blob()`. The Blob URL approach is verified to work in both browser and Tauri webview contexts.

The only real complexity is the folder-path construction for the zip: walking each leaf's `parentId` chain to the root, reversing, and building `{nodeId}/.../{nodeId}-{label}.md` paths. This is deterministic from the flat `PrdTree` already in the Zustand store.

**Primary recommendation:** Implement in four discrete tasks — (1) TopAppBar props extension + gate UI, (2) MapPage canExport computation + export handler, (3) `exportSpec()` in api.ts, (4) server `/api/export-zip` route with fflate.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fflate | 0.8.3 (latest verified 2026-05-27) | Zip creation on server | Pure JS, zero deps, ~7KB, synchronous `zipSync` API works perfectly in Node.js Express handler |
| fetch (browser native) | N/A | Binary file download from server | Blob URL download pattern is standard for programmatic downloads; no extra library needed |

> **Version verified:** `npm view fflate version` returned `0.8.3` on 2026-05-27.

**fflate is not yet installed.** The plan MUST include `npm install fflate` as the first task.

### Supporting (already in project — no install needed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Express | ^5.2.1 | Server endpoint routing | `/api/export-zip` follows existing `app.post` patterns |
| Zustand | ^5.0.13 | prdTree source of truth | MapPage reads `prdTree` from store to compute `canExport` and pass to server |
| TypeScript | latest | Type safety | `ExportZipRequest` interface for request body; typed path builder |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| fflate | jszip | jszip is 100KB+ with heavier API; fflate is correct and lighter |
| fflate | archiver (Node stream) | archiver requires streams and piping; overkill for sync zip |
| Blob URL download | Tauri `plugin-dialog` + `plugin-fs` | Works but deferred to v2 per D-deferred |
| fetch + blob | axios | Unnecessary dep; raw fetch handles binary cleanly |

**Installation:**
```bash
npm install fflate
```

---

## Architecture Patterns

### Recommended File Changes
```
src/
├── components/map/TopAppBar.tsx     # Extend props: canExport?, onExport?, isExporting?
├── pages/MapPage.tsx                # Compute canExport, manage isExporting state, call exportSpec
└── lib/api.ts                       # Add exportSpec(baseUrl, tree): Promise<Blob>

server/
└── index.ts                         # Add POST /api/export-zip route after /api/node-chat
```

### Pattern 1: TopAppBar Props Extension

**What:** Add three optional props to `TopAppBarProps`. Button renders only when `onExport` is present, avoiding hard break of usages without the prop.

**When to use:** Any time TopAppBar is used in the map stage with export capability.

```typescript
// src/components/map/TopAppBar.tsx
interface TopAppBarProps {
  onUploadNew: () => void
  canExport?: boolean
  onExport?: () => void
  isExporting?: boolean
}

export function TopAppBar({ onUploadNew, canExport, onExport, isExporting }: TopAppBarProps) {
  // ...existing JSX...
  // In the right-side button group:
  {onExport && (
    <button
      onClick={onExport}
      disabled={!canExport || isExporting}
      title={!canExport ? '所有节点完成后才能导出' : undefined}
      className={[
        'flex items-center gap-sm rounded-lg px-md py-sm font-label-md text-label-md border transition-colors',
        canExport && !isExporting
          ? 'bg-secondary-container text-on-secondary-container border-[#2b88ff]/30 hover:bg-secondary-container/90 cursor-pointer active:opacity-80'
          : 'bg-surface-container-high text-on-surface border-outline-variant opacity-40 cursor-not-allowed',
      ].join(' ')}
    >
      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
        {isExporting ? 'sync' : 'download'}
      </span>
      {isExporting ? '生成中...' : '导出 Spec'}
    </button>
  )}
}
```

**Design system alignment:** `bg-secondary-container text-on-secondary-container` matches the "Enter Deep Forge" CTA button pattern in the stitch mockup (Image 2.html line 322). `opacity-40 cursor-not-allowed` matches D-03.

### Pattern 2: MapPage canExport Computation

**What:** Pure computed value from the existing `prdTree` store slice. No additional state needed for the gate itself.

```typescript
// src/pages/MapPage.tsx (inside the stage='map' branch)
const canExport = Object.values(prdTree).length > 0
  && Object.values(prdTree)
      .filter(n => n.children.length === 0)   // leaf nodes only (D-02)
      .every(n => n.status === 'done')

const [isExporting, setIsExporting] = useState(false)

const handleExport = async () => {
  setIsExporting(true)
  try {
    const blob = await exportSpec(settings.proxyBaseUrl, prdTree)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'spec-export.zip'
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    // Discretion: reuse existing error banner pattern or alert()
    console.error('Export failed:', err)
  } finally {
    setIsExporting(false)
  }
}
```

**Note:** `canExport` must guard against an empty tree (no nodes at all) — add `Object.values(prdTree).length > 0` to avoid vacuously true result when tree is empty.

### Pattern 3: exportSpec() in api.ts

**What:** Raw `fetch()` returning `Blob`. Cannot use `requestJson<T>` because that always calls `.json()`.

```typescript
// src/lib/api.ts
export async function exportSpec(
  baseUrl: string,
  tree: Record<string, PrdNode>
): Promise<Blob> {
  const response = await fetch(`${baseUrl}/api/export-zip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tree }),
  })
  if (!response.ok) {
    // Try to parse error JSON; fall back to status text
    let message = `Export failed: ${response.status}`
    try {
      const data = await response.json() as { error?: string }
      if (data.error) message = data.error
    } catch { /* ignore */ }
    throw new Error(message)
  }
  return response.blob()
}
```

### Pattern 4: Server /api/export-zip Route

**What:** POST endpoint that receives the full `prdTree`, generates Markdown per leaf, builds a fflate zip, and streams binary back.

```typescript
// server/index.ts — add after /api/node-chat

import { zipSync } from 'fflate'

interface ExportZipRequest {
  tree: Record<string, PrdNode>
}

function sanitizeLabel(label: string): string {
  return label
    .replace(/[^\w一-鿿\-]/g, '-')   // keep word chars, CJK, hyphens
    .replace(/-+/g, '-')                        // collapse multiple hyphens
    .slice(0, 40)
    .replace(/^-|-$/g, '')                      // trim leading/trailing hyphens
}

function buildNodePath(nodeId: string, tree: Record<string, PrdNode>): string {
  // D-12: walk parentId chain, collect IDs from leaf to root, reverse
  const parts: string[] = []
  let current: PrdNode | undefined = tree[nodeId]
  while (current) {
    parts.unshift(current.id)
    current = current.parentId ? tree[current.parentId] : undefined
  }
  // parts = [rootId, ...ancestors, leafId]
  // Folder segments: all except the last become directories; last becomes filename
  const folders = parts.slice(0, -1).map(id => id)
  const leaf = tree[nodeId]
  const filename = `${leaf.id}-${sanitizeLabel(leaf.label)}.md`
  return [...folders, filename].join('/')
}

function generateMarkdown(node: PrdNode): string {
  const lines = [
    `# ${node.label}`,
    '',
    `**ID:** ${node.id}`,
    `**Type:** ${node.type}`,
    `**Status:** 已完成`,
    '',
    '## 需求摘要',
    '',
    node.summary,
    '',
    '## 详细内容',
    '',
    node.content,
  ]
  if (node.techNotes) {
    lines.push('', '## 技术备注', '', node.techNotes)
  }
  return lines.join('\n')
}

app.post('/api/export-zip', (req, res) => {
  const { tree } = req.body as ExportZipRequest

  if (!tree || typeof tree !== 'object') {
    res.status(400).json({ error: 'tree is required' })
    return
  }

  const nodes = Object.values(tree)
  const leafNodes = nodes.filter(n => n.children.length === 0 && n.status === 'done')

  if (leafNodes.length === 0) {
    res.status(400).json({ error: 'No completed leaf nodes found' })
    return
  }

  const files: Record<string, Uint8Array> = {}
  for (const node of leafNodes) {
    const path = buildNodePath(node.id, tree)
    const content = generateMarkdown(node)
    files[path] = Buffer.from(content, 'utf-8')
  }

  const zipped = zipSync(files)

  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', 'attachment; filename="spec-export.zip"')
  res.end(Buffer.from(zipped))
})
```

### Anti-Patterns to Avoid

- **Using `requestJson<T>` for binary responses:** It always calls `.json()`, which will fail or corrupt binary data. Use raw `fetch()` for the export endpoint.
- **Calling `zipSync` on the client-side:** fflate works in browser too but the Blob pattern sends the PrdTree to the server — keep generation server-side to align with D-05.
- **Streaming the zip:** `zipSync` is synchronous and fast enough for typical PRD sizes (dozens of nodes). No need for `zip` (async) or stream piping.
- **Label-only folder names:** Using label text in folder names risks filesystem-unsafe characters (Chinese chars, slashes, colons). D-12 mandates `node.id` only for folder segments; label appears only in the leaf filename after sanitization.
- **Empty tree edge case:** If `prdTree` is `{}` (e.g., session was reset), `every()` returns `true` vacuously. Guard with `length > 0` check.
- **Forgetting to revoke Blob URL:** `URL.revokeObjectURL(url)` must be called after `a.click()` to avoid memory leaks. Since `a.click()` is synchronous in this context, revoke can happen immediately after.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Zip file creation | Custom binary zip format writer | `fflate` `zipSync` | ZIP format has local file headers, central directory, end-of-central-directory record — ~200 lines of spec compliance |
| File sanitization | Ad-hoc replace chains | Documented regex pattern (see Pattern 4) | Edge cases: CJK chars, control chars, path separators inside labels |
| Binary HTTP response | Custom base64 encoding | `res.end(Buffer.from(zipped))` + `Content-Type: application/zip` | Express already handles binary buffers correctly |
| Programmatic download | Hidden form POST | Blob URL + `<a download>` click | The standard cross-browser pattern; no server redirect needed |

**Key insight:** ZIP format internals are genuinely complex. `fflate`'s `zipSync` accepts a flat `Record<string, Uint8Array>` and handles all format details. The only application logic is path construction.

---

## Runtime State Inventory

> SKIPPED — this is a greenfield feature addition, not a rename/refactor/migration phase.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | server zip generation | Yes | (project running) | — |
| npm | installing fflate | Yes | (project uses npm) | — |
| fflate | /api/export-zip | NOT YET INSTALLED | needs 0.8.3 | none — must install |
| fetch (browser) | Blob URL download | Yes (browser + Tauri webview) | native | — |
| URL.createObjectURL | Blob URL download | Yes (browser + Tauri webview) | native | — |

**Missing dependencies with no fallback:**
- `fflate` — must be installed via `npm install fflate` before server route can be implemented

**Missing dependencies with fallback:**
- None

---

## Common Pitfalls

### Pitfall 1: Vacuous `every()` on empty leaf array

**What goes wrong:** If all nodes are non-leaf (e.g., tree with only root), `filter(n => n.children.length === 0)` returns `[]`, and `[].every(...)` is `true`. Export button becomes incorrectly enabled on an empty document.

**Why it happens:** JavaScript's `every()` returns `true` for empty arrays (vacuous truth).

**How to avoid:** Guard with `Object.values(prdTree).length > 0 &&` before the `every()` check.

**Warning signs:** Export button appears enabled immediately after a reset/upload.

### Pitfall 2: fflate `zipSync` path separator

**What goes wrong:** Using `\` (backslash) as path separator in zip entries. ZIP format requires forward slashes `/` for directory separators. On Windows, naive `path.join()` produces backslashes.

**Why it happens:** Node.js `path.join()` is OS-aware. On Windows it uses `\`.

**How to avoid:** Concatenate paths with `/` directly (as shown in Pattern 4 `parts.join('/')`) rather than using `path.join()`. Never use `path.join()` for zip entry paths.

**Warning signs:** Zip opens but shows flat structure (all files at root, no folders) on some unzippers.

### Pitfall 3: Blob URL memory leak

**What goes wrong:** Creating Blob URLs without revoking them accumulates memory over multiple exports.

**Why it happens:** `URL.createObjectURL()` creates a persistent in-memory reference until explicitly revoked.

**How to avoid:** Always call `URL.revokeObjectURL(url)` immediately after `a.click()`.

**Warning signs:** Memory usage grows with each export click.

### Pitfall 4: Express v5 `res.end()` vs `res.send()` for binary

**What goes wrong:** `res.send(Buffer)` in Express v5 may set `Content-Type: application/octet-stream` and override the zip content-type header set before it.

**Why it happens:** `res.send()` auto-detects content type from the argument. `res.end()` sends raw without header interference.

**How to avoid:** Set headers first, then use `res.end(Buffer.from(zipped))` — not `res.send()`. This matches the fflate example in CONTEXT.md specifics.

**Warning signs:** Browser receives file with wrong MIME type or wrong extension.

### Pitfall 5: Chinese characters in sanitized label filenames

**What goes wrong:** Overly aggressive sanitization strips all CJK characters, producing filenames like `CE-01-.md`.

**Why it happens:** `\w` in JavaScript regex does NOT match CJK Unicode characters.

**How to avoid:** Include CJK range explicitly in the keep-list: `[^\w一-鿿\-]` (as shown in Pattern 4). This preserves Chinese characters in filenames while removing truly unsafe chars.

**Warning signs:** All Chinese node labels produce near-empty sanitized names.

---

## Code Examples

Verified patterns from official sources and codebase inspection:

### fflate zipSync (from fflate npm package README)

```typescript
import { zipSync } from 'fflate'

// Build a flat map of paths to Uint8Array content
const files: Record<string, Uint8Array> = {
  'folder/subfolder/file.md': new TextEncoder().encode('# Hello'),
  'folder/other.md': new TextEncoder().encode('# World'),
}

// zipSync is synchronous — returns Uint8Array
const zipped = zipSync(files)

// In Express:
res.setHeader('Content-Type', 'application/zip')
res.setHeader('Content-Disposition', 'attachment; filename="spec-export.zip"')
res.end(Buffer.from(zipped))
```

Source: fflate README + verified via `npm view fflate` (0.8.3, published 2026-05-16)

### Blob URL download (client-side)

```typescript
// Standard programmatic download pattern — no library needed
const blob = await exportSpec(settings.proxyBaseUrl, prdTree)
const url = URL.createObjectURL(blob)
const a = document.createElement('a')
a.href = url
a.download = 'spec-export.zip'
a.click()
URL.revokeObjectURL(url)
```

Source: CONTEXT.md D-06 specifics — confirmed works in Tauri webview (both support Blob URLs per CONTEXT.md).

### Existing TopAppBar button pattern to match

```tsx
// From src/components/map/TopAppBar.tsx (verified current file)
<button
  onClick={onUploadNew}
  className="flex items-center gap-sm bg-surface-container-high hover:bg-surface-variant transition-colors text-on-surface border border-outline-variant rounded-lg px-md py-sm font-label-md text-label-md cursor-pointer active:opacity-80"
>
  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>upload_file</span>
  Upload PRD
</button>
```

Export button active state uses `bg-secondary-container text-on-secondary-container` per D-03, which matches the "Enter Deep Forge" button pattern in the stitch mockup.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| JSZip (common older choice) | fflate | ~2021 | fflate is faster, smaller, zero-dep; JSZip is still maintained but heavier |
| Hidden form POST for file download | Blob URL + `<a download>` | ~2016 | Universal browser support; works in Tauri webview |
| archiver (Node.js streams) | fflate zipSync | N/A | Streams needed for large archives; synchronous fine for PRD-scale zips |

**Deprecated/outdated:**
- `download` attribute on anchor tags requires same-origin or blob URL — confirmed OK here since blob URLs are always same-origin.

---

## Open Questions

1. **Error UX (Claude's Discretion)**
   - What we know: Existing `ChatPanel` shows a red error banner on API failure; `AppShell.handleExportPrompt()` uses `alert()`.
   - What's unclear: Which pattern to reuse for MapPage export failure.
   - Recommendation: Use `useState<string | null>(exportError, setExportError)` in MapPage and render an inline error banner below TopAppBar — consistent with ChatPanel pattern. Avoid `alert()`.

2. **Success notification (Claude's Discretion)**
   - What we know: Browser will show OS-native download notification when the file saves. No explicit success toast needed.
   - What's unclear: Whether user expects in-app confirmation.
   - Recommendation: Skip success toast; browser download indicator is sufficient for a one-shot operation.

3. **isExporting spinner icon**
   - What we know: `material-symbols-outlined` `sync` icon is available in the project (Google Fonts loaded).
   - Recommendation: Use `sync` with CSS `animate-spin` class for the loading state — consistent with other loading indicators in the project.

---

## Validation Architecture

> `nyquist_validation` is explicitly `false` in `.planning/config.json` — this section is SKIPPED.

---

## Sources

### Primary (HIGH confidence)
- `D:\learn\auto_ux_prd\.planning\phases\04-export\04-CONTEXT.md` — all implementation decisions (verified by reading current file)
- `D:\learn\auto_ux_prd\src\components\map\TopAppBar.tsx` — current props interface and button JSX (verified by reading current file)
- `D:\learn\auto_ux_prd\src\lib\api.ts` — existing API function patterns (verified by reading current file)
- `D:\learn\auto_ux_prd\server\index.ts` — Express route patterns, `/api/node-chat` endpoint shape (verified by reading current file)
- `D:\learn\auto_ux_prd\src\types\prdNode.ts` — PrdNode interface (verified by reading current file)
- `npm view fflate version` — confirmed 0.8.3, published 2026-05-16 (verified via npm registry)
- `D:\learn\auto_ux_prd\stitch\main\Image 2.html` — Forge Blueprint button styles (verified by reading design file)

### Secondary (MEDIUM confidence)
- fflate README / npm package page — `zipSync` API shape and path separator behavior (cross-referenced with CONTEXT.md specifics which show matching usage)

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — fflate version verified via npm; all other libraries already in project
- Architecture: HIGH — all patterns traced directly from locked CONTEXT.md decisions and current source files
- Pitfalls: HIGH — most derive from direct code inspection (vacuous every, path separator) or verified Express v5 behavior

**Research date:** 2026-05-27
**Valid until:** 2026-06-27 (fflate is stable; no fast-moving dependencies)
